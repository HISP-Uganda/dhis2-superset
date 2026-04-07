"""Celery tasks for AI push analysis — scheduled insight generation, PDF reports, and email."""
from __future__ import annotations

import io
import logging
import re
from datetime import datetime
from time import perf_counter
from typing import Any

from celery.exceptions import SoftTimeLimitExceeded

from superset import is_feature_enabled
from superset.extensions import celery_app, db

logger = logging.getLogger(__name__)


# ── PDF Report Generation ──────────────────────────────────────────


def _generate_pdf_report(
    schedule_name: str,
    insight_text: str,
    charts: list[dict[str, Any]],
    include_charts: bool = True,
    provider_id: str | None = None,
    model_name: str | None = None,
) -> bytes:
    """Generate a professional PDF report from AI insight text.

    Uses fpdf2 to produce a multi-page PDF with:
    - Title page with report name, date, branding
    - Executive summary and detailed analysis sections
    - Chart metadata cards
    - Professional formatting with headers, body text, severity badges
    """
    from fpdf import FPDF

    class ReportPDF(FPDF):
        def header(self):
            if self.page_no() > 1:
                self.set_font("Helvetica", "I", 8)
                self.set_text_color(128, 128, 128)
                self.cell(0, 8, schedule_name, align="L")
                self.cell(
                    0, 8,
                    datetime.utcnow().strftime("%Y-%m-%d"),
                    align="R", new_x="LMARGIN", new_y="NEXT",
                )
                self.set_draw_color(200, 200, 200)
                self.line(10, self.get_y(), 200, self.get_y())
                self.ln(4)

        def footer(self):
            self.set_y(-15)
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(128, 128, 128)
            ai_label = "AI Insights"
            if provider_id:
                ai_label += f" \u2014 {provider_id}"
                if model_name:
                    ai_label += f" / {model_name}"
            page_text = f"Page {self.page_no()}/{{nb}}"
            self.cell(0, 10, ai_label, align="L")
            self.set_x(-30)
            self.cell(0, 10, page_text, align="R")

    pdf = ReportPDF(orientation="P", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # ── Title Page ──
    pdf.add_page()
    pdf.ln(40)
    pdf.set_font("Helvetica", "B", 28)
    pdf.set_text_color(30, 64, 120)
    pdf.multi_cell(0, 14, schedule_name, align="C")
    pdf.ln(8)
    pdf.set_font("Helvetica", "", 14)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(
        0, 10, "AI Push Analysis Report",
        align="C", new_x="LMARGIN", new_y="NEXT",
    )
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 12)
    now = datetime.utcnow()
    pdf.cell(
        0, 8,
        f"Generated: {now.strftime('%B %d, %Y at %H:%M UTC')}",
        align="C", new_x="LMARGIN", new_y="NEXT",
    )
    pdf.ln(20)

    # Charts summary on title page
    if charts and include_charts:
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(60, 60, 60)
        pdf.cell(
            0, 8, f"Data Sources Analyzed: {len(charts)} charts",
            align="C", new_x="LMARGIN", new_y="NEXT",
        )
        pdf.ln(4)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(100, 100, 100)
        for i, chart in enumerate(charts[:12], 1):
            name = chart.get("name") or chart.get("slice_name") or f"Chart {i}"
            viz = chart.get("viz_type") or ""
            line = f"{i}. {name}"
            if viz:
                line += f"  ({viz})"
            pdf.cell(0, 5, line, align="C", new_x="LMARGIN", new_y="NEXT")

    # ── Content Pages ──
    pdf.add_page()

    # Apply word spacing fix before rendering
    insight_text = _fix_word_spacing(insight_text)

    # Severity badge colors
    severity_colors = {
        "CRITICAL": (220, 38, 38),
        "WARNING": (234, 179, 8),
        "GOOD": (22, 163, 74),
        "INFO": (59, 130, 246),
    }

    _table_header_done = False

    def write_severity_badge(tag: str) -> None:
        color = severity_colors.get(tag, (100, 100, 100))
        pdf.set_fill_color(*color)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 8)
        w = pdf.get_string_width(f" {tag} ") + 4
        pdf.cell(w, 5, f" {tag} ", fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

    def write_markdown_line(raw_line: str) -> None:
        nonlocal _table_header_done
        line = raw_line.rstrip()
        if not line:
            _table_header_done = False
            pdf.ln(3)
            return

        # Severity tags
        severity_match = re.match(r"\[([A-Z]+)\]\s*(.*)", line)
        if severity_match and severity_match.group(1) in severity_colors:
            tag = severity_match.group(1)
            rest = severity_match.group(2)
            write_severity_badge(tag)
            if rest.strip():
                pdf.set_text_color(31, 41, 55)
                pdf.set_font("Helvetica", "", 10)
                pdf.multi_cell(0, 5, rest)
            return

        # H2: ## Title
        if line.startswith("## "):
            pdf.ln(6)
            pdf.set_font("Helvetica", "B", 14)
            pdf.set_text_color(30, 64, 120)
            pdf.multi_cell(0, 7, line[3:].strip())
            pdf.set_draw_color(30, 64, 120)
            pdf.line(10, pdf.get_y() + 1, 120, pdf.get_y() + 1)
            pdf.ln(4)
            return

        # H3: ### Title
        if line.startswith("### "):
            pdf.ln(4)
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(55, 65, 81)
            pdf.multi_cell(0, 6, line[4:].strip())
            pdf.ln(2)
            return

        # H1: # Title
        if line.startswith("# "):
            pdf.ln(6)
            pdf.set_font("Helvetica", "B", 16)
            pdf.set_text_color(17, 24, 39)
            pdf.multi_cell(0, 8, line[2:].strip())
            pdf.ln(4)
            return

        # Bullet points
        if line.startswith("- ") or line.startswith("* "):
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(31, 41, 55)
            pdf.cell(6, 5, chr(8226))
            pdf.multi_cell(0, 5, line[2:].strip())
            return

        # Numbered list items
        num_match = re.match(r"^(\d+[\.\)]\s+)(.*)", line)
        if num_match:
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(30, 64, 120)
            pdf.cell(10, 5, num_match.group(1))
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(31, 41, 55)
            pdf.multi_cell(0, 5, num_match.group(2))
            return

        # Table rows
        if "|" in line and line.strip().startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(set(c) <= {"-", ":"} for c in cells if c):
                return  # skip separator rows
            col_width = (190 - 20) / max(len(cells), 1)
            is_header = not _table_header_done
            if is_header:
                pdf.set_font("Helvetica", "B", 9)
                pdf.set_fill_color(230, 234, 240)
                _table_header_done = True
            else:
                pdf.set_font("Helvetica", "", 9)
                pdf.set_fill_color(255, 255, 255)
            pdf.set_text_color(31, 41, 55)
            for cell in cells:
                pdf.cell(
                    col_width, 6, cell[:50], border=1,
                    fill=is_header,
                )
            pdf.ln()
            return

        # Regular paragraph
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(31, 41, 55)
        cleaned = re.sub(r"\*\*(.+?)\*\*", r"\1", line)
        pdf.multi_cell(0, 5, cleaned)

    # Render the insight text
    for raw_line in insight_text.split("\n"):
        write_markdown_line(raw_line)

    # ── Chart Details Appendix ──
    if charts and include_charts:
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(30, 64, 120)
        pdf.cell(0, 10, "Appendix: Chart Metadata", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)

        for i, chart in enumerate(charts, 1):
            name = chart.get("name") or chart.get("slice_name") or f"Chart {i}"
            viz = chart.get("viz_type") or "unknown"
            ds = chart.get("datasource") or {}
            table = ds.get("table_name") or "N/A"
            schema = ds.get("schema") or ""
            row_count = chart.get("row_count")

            y_start = pdf.get_y()
            if y_start > 250:
                pdf.add_page()
                y_start = pdf.get_y()

            pdf.set_fill_color(248, 250, 252)
            pdf.rect(10, y_start, 190, 22, style="F")
            pdf.set_draw_color(200, 200, 200)
            pdf.rect(10, y_start, 190, 22, style="D")

            pdf.set_xy(14, y_start + 2)
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(31, 41, 55)
            pdf.cell(0, 6, f"{i}. {name}")
            pdf.set_xy(14, y_start + 8)
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(107, 114, 128)
            meta_parts = [f"Type: {viz}", f"Table: {table}"]
            if schema:
                meta_parts.append(f"Schema: {schema}")
            if row_count is not None:
                meta_parts.append(f"Rows: {row_count:,}")
            pdf.cell(0, 5, "  |  ".join(meta_parts))

            pdf.set_y(y_start + 26)

    return pdf.output()


# ── Email Delivery ──────────────────────────────────────────────────


def _send_report_email(
    recipients: list[dict[str, str]],
    subject: str,
    insight_text: str,
    pdf_bytes: bytes | None = None,
    schedule_name: str = "",
    provider_id: str | None = None,
    model_name: str | None = None,
) -> int:
    """Send the report via email to all configured recipients.

    Returns the number of recipients successfully notified.
    """
    from flask import current_app

    from superset.utils.core import send_email_smtp

    config = current_app.config

    smtp_config = {
        "SMTP_HOST": config.get("SMTP_HOST", "localhost"),
        "SMTP_PORT": config.get("SMTP_PORT", 25),
        "SMTP_STARTTLS": config.get("SMTP_STARTTLS", True),
        "SMTP_SSL": config.get("SMTP_SSL", False),
        "SMTP_USER": config.get("SMTP_USER", ""),
        "SMTP_PASSWORD": config.get("SMTP_PASSWORD", ""),
        "SMTP_MAIL_FROM": config.get("SMTP_MAIL_FROM", "superset@superset.com"),
        "SMTP_SSL_SERVER_AUTH": config.get("SMTP_SSL_SERVER_AUTH", False),
        "EMAIL_HEADER_MUTATOR": config.get(
            "EMAIL_HEADER_MUTATOR", lambda msg, **kwargs: msg
        ),
    }

    email_targets = [
        r["target"] for r in recipients
        if r.get("type") == "email" and r.get("target")
    ]
    if not email_targets:
        return 0

    to_list = ",".join(email_targets)

    # Build HTML email body
    html_body = _build_email_html(schedule_name, insight_text, provider_id, model_name)

    # Attach PDF if available
    pdf_attachments: dict[str, bytes] | None = None
    if pdf_bytes:
        safe_name = re.sub(r"[^\w\s-]", "", schedule_name).strip().replace(" ", "_")
        pdf_filename = f"{safe_name}_{datetime.utcnow().strftime('%Y%m%d')}.pdf"
        pdf_attachments = {pdf_filename: pdf_bytes}

    notified = 0
    try:
        send_email_smtp(
            to=to_list,
            subject=subject,
            html_content=html_body,
            config=smtp_config,
            pdf=pdf_attachments,
        )
        notified = len(email_targets)
        logger.info("Push analysis email sent to %d recipients", notified)
    except Exception:  # pylint: disable=broad-except
        logger.exception("Failed to send push analysis email")

    return notified


def _fix_word_spacing(text: str) -> str:
    """Fix common word-spacing issues in AI-generated text.

    AI models sometimes concatenate words or omit spaces after punctuation.
    This Python equivalent of the frontend fixWordSpacing function repairs
    those issues while preserving markdown syntax and URLs.
    """
    lines = text.split("\n")
    fixed_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip code blocks, table rows, URLs
        if (
            stripped.startswith("```")
            or stripped.startswith("|")
            or stripped.startswith("![")
            or re.match(r"^https?://", stripped)
        ):
            fixed_lines.append(line)
            continue

        fixed = line
        # Punctuation spacing: "value,but" → "value, but"
        fixed = re.sub(r"([a-zA-Z])([,;])([a-zA-Z])", r"\1\2 \3", fixed)
        # Period + uppercase = sentence boundary: "system.The" → "system. The"
        fixed = re.sub(r"([a-z])\.([A-Z])", r"\1. \2", fixed)
        # Colon + letter (not time): "key:value" → "key: value"
        fixed = re.sub(r"([a-zA-Z]):([a-zA-Z])", r"\1: \2", fixed)
        # Space before paren: "rate(95%)" → "rate (95%)"
        fixed = re.sub(r"([a-zA-Z])\((?!\))", r"\1 (", fixed)
        # camelCase mid-sentence: "highlightsA" → "highlights A"
        fixed = re.sub(r"(?<!`)([a-z]{2,})([A-Z][a-z])(?!`)", r"\1 \2", fixed)
        # Collapse double-spaces
        fixed = re.sub(r" {2,}", " ", fixed)

        fixed_lines.append(fixed)
    return "\n".join(fixed_lines)


def _build_email_html(
    schedule_name: str,
    insight_text: str,
    provider_id: str | None = None,
    model_name: str | None = None,
) -> str:
    """Build a professional HTML email body from the insight text."""
    now = datetime.utcnow().strftime("%B %d, %Y at %H:%M UTC")

    # Apply word spacing fix before rendering
    text = _fix_word_spacing(insight_text)

    lines = text.split("\n")
    body_html = ""
    in_table = False
    for line in lines:
        line = line.rstrip()
        if not line:
            if in_table:
                body_html += "</table>"
                in_table = False
            body_html += "<br/>"
            continue

        # Table rows
        if line.strip().startswith("|") and "|" in line[1:]:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            # Skip separator rows
            if all(set(c) <= {"-", ":"} for c in cells if c):
                continue
            if not in_table:
                in_table = True
                body_html += (
                    '<table style="border-collapse:collapse;width:100%;'
                    'margin:8px 0;font-size:13px;">'
                )
                # First row is header
                body_html += "<tr>"
                for cell in cells:
                    body_html += (
                        f'<th style="border:1px solid #D1D5DB;padding:6px 10px;'
                        f'background:#E6EAF0;font-weight:600;color:#1F2937;'
                        f'text-align:left;">{cell}</th>'
                    )
                body_html += "</tr>"
            else:
                body_html += "<tr>"
                for cell in cells:
                    formatted_cell = re.sub(
                        r"\*\*(.+?)\*\*", r"<strong>\1</strong>", cell,
                    )
                    body_html += (
                        f'<td style="border:1px solid #D1D5DB;padding:5px 10px;'
                        f'color:#1F2937;">{formatted_cell}</td>'
                    )
                body_html += "</tr>"
            continue

        if in_table:
            body_html += "</table>"
            in_table = False

        # Severity badges
        sev_match = re.match(r"\[([A-Z]+)\]\s*(.*)", line)
        if sev_match and sev_match.group(1) in (
            "CRITICAL", "WARNING", "GOOD", "INFO",
        ):
            tag = sev_match.group(1)
            colors = {
                "CRITICAL": ("#DC2626", "#FEF2F2"),
                "WARNING": ("#D97706", "#FFFBEB"),
                "GOOD": ("#16A34A", "#F0FDF4"),
                "INFO": ("#2563EB", "#EFF6FF"),
            }
            fg, bg = colors.get(tag, ("#666", "#f5f5f5"))
            rest = sev_match.group(2)
            body_html += (
                f'<div style="margin:6px 0;padding:8px 12px;background:{bg};'
                f'border-left:4px solid {fg};border-radius:4px;">'
                f'<span style="font-weight:700;color:{fg};font-size:11px;">'
                f'[{tag}]</span> '
                f'<span style="color:#1F2937;">{rest}</span></div>'
            )
            continue

        if line.startswith("## "):
            body_html += (
                f'<h2 style="color:#1E4078;margin:18px 0 8px;font-size:18px;'
                f'border-bottom:2px solid #1E4078;padding-bottom:4px;">'
                f'{line[3:]}</h2>'
            )
            continue
        if line.startswith("### "):
            body_html += (
                f'<h3 style="color:#374151;margin:14px 0 6px;font-size:15px;">'
                f'{line[4:]}</h3>'
            )
            continue
        if line.startswith("# "):
            body_html += (
                f'<h1 style="color:#111827;margin:16px 0 8px;font-size:22px;">'
                f'{line[2:]}</h1>'
            )
            continue

        if line.startswith("- ") or line.startswith("* "):
            body_html += (
                f'<div style="margin:2px 0 2px 16px;color:#1F2937;">'
                f'&bull; {line[2:]}</div>'
            )
            continue

        formatted = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
        body_html += (
            f'<p style="margin:4px 0;color:#1F2937;line-height:1.6;">'
            f'{formatted}</p>'
        )

    if in_table:
        body_html += "</table>"

    # Read app name from config for branding
    try:
        from flask import current_app as _app
        app_name = _app.config.get("APP_NAME", "Superset")
    except RuntimeError:
        app_name = "Superset"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:680px;margin:0 auto;background:#fff;">
  <div style="background:linear-gradient(135deg,#1E4078,#2563EB);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">{schedule_name}</h1>
    <p style="color:#BFDBFE;margin:8px 0 0;font-size:13px;">{app_name} &mdash; {now}</p>
  </div>
  <div style="padding:24px;font-size:14px;line-height:1.6;">
    {body_html}
  </div>
  <div style="background:#F9FAFB;padding:16px 24px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="color:#9CA3AF;font-size:11px;margin:0;">
      AI Insights{f' &mdash; {provider_id}' if provider_id else ''}{f' / {model_name}' if model_name else ''}
    </p>
  </div>
</div>
</body>
</html>"""


# ── Celery Tasks ────────────────────────────────────────────────────


@celery_app.task(
    name="ai_push_analysis.execute_schedule",
    bind=True,
    soft_time_limit=300,
    time_limit=360,
)
def execute_push_analysis_schedule(self: Any, schedule_id: int) -> None:
    """Execute a single push analysis schedule: generate report, PDF, and email."""
    from superset.ai_insights.config import (
        AI_INSIGHTS_FEATURE_FLAG,
        get_ai_insights_config,
    )
    from superset.ai_insights.providers import AIProviderError
    from superset.ai_insights.push_analysis import PushAnalysisResult, PushAnalysisSchedule
    from superset.ai_insights.service import AIInsightService

    if not is_feature_enabled(AI_INSIGHTS_FEATURE_FLAG):
        logger.info("AI_INSIGHTS feature flag disabled, skipping push analysis")
        return

    schedule = db.session.query(PushAnalysisSchedule).get(schedule_id)
    if not schedule or not schedule.enabled:
        logger.info("Schedule %s not found or disabled", schedule_id)
        return

    started_at = perf_counter()
    try:
        config = get_ai_insights_config()
        service = AIInsightService(config)

        report_data = service.generate_push_report({
            "dashboard_id": schedule.dashboard_id,
            "chart_id": schedule.chart_id,
            "question": schedule.question,
            "provider_id": schedule.provider_id,
            "model_name": schedule.model_name,
        })

        insight_text = report_data["insight_text"]
        charts = report_data.get("charts") or []
        duration_ms = int((perf_counter() - started_at) * 1000)

        # Generate PDF report
        pdf_bytes: bytes | None = None
        if schedule.report_format in ("pdf", None, ""):
            try:
                pdf_bytes = _generate_pdf_report(
                    schedule_name=schedule.name,
                    insight_text=insight_text,
                    charts=charts,
                    include_charts=schedule.include_charts,
                    provider_id=report_data.get("provider_id"),
                    model_name=report_data.get("model"),
                )
                logger.info(
                    "PDF report generated for schedule %s (%d bytes)",
                    schedule_id, len(pdf_bytes),
                )
            except Exception:  # pylint: disable=broad-except
                logger.exception("PDF generation failed for schedule %s", schedule_id)

        # Send email notifications
        recipients = schedule.recipients
        notified = 0
        if recipients:
            subject = (
                schedule.subject_line
                or f"AI Push Analysis: {schedule.name} - "
                   f"{datetime.utcnow().strftime('%Y-%m-%d')}"
            )
            notified = _send_report_email(
                recipients=recipients,
                subject=subject,
                insight_text=insight_text,
                pdf_bytes=pdf_bytes,
                schedule_name=schedule.name,
                provider_id=report_data.get("provider_id"),
                model_name=report_data.get("model"),
            )

        # Save result
        result = PushAnalysisResult(
            schedule_id=schedule.id,
            insight_text=insight_text,
            report_pdf=pdf_bytes,
            provider_id=report_data.get("provider_id"),
            model_name=report_data.get("model"),
            duration_ms=duration_ms,
            status="success",
            recipients_notified=notified,
            created_on=datetime.utcnow(),
        )
        schedule.last_run_at = datetime.utcnow()
        schedule.last_status = "success"
        schedule.last_error = None
        db.session.add(result)
        db.session.commit()

        logger.info(
            "Push analysis schedule %s completed in %dms, %d recipients notified",
            schedule_id, duration_ms, notified,
        )

    except (AIProviderError, SoftTimeLimitExceeded) as ex:
        duration_ms = int((perf_counter() - started_at) * 1000)
        error_msg = str(ex)
        result = PushAnalysisResult(
            schedule_id=schedule.id,
            insight_text=None,
            duration_ms=duration_ms,
            status="error",
            error_message=error_msg,
            created_on=datetime.utcnow(),
        )
        schedule.last_run_at = datetime.utcnow()
        schedule.last_status = "error"
        schedule.last_error = error_msg
        db.session.add(result)
        db.session.commit()
        logger.error("Push analysis schedule %s failed: %s", schedule_id, error_msg)

    except Exception:  # pylint: disable=broad-except
        db.session.rollback()
        logger.exception("Unexpected error in push analysis schedule %s", schedule_id)


@celery_app.task(
    name="ai_push_analysis.run_all_due",
    bind=True,
    soft_time_limit=300,
)
def run_all_due_push_analyses(self: Any) -> None:
    """Scan all enabled push analysis schedules and execute those that are due."""
    from superset.ai_insights.config import AI_INSIGHTS_FEATURE_FLAG
    from superset.ai_insights.push_analysis import PushAnalysisSchedule

    if not is_feature_enabled(AI_INSIGHTS_FEATURE_FLAG):
        return

    schedules = (
        db.session.query(PushAnalysisSchedule)
        .filter(PushAnalysisSchedule.enabled.is_(True))
        .all()
    )

    for schedule in schedules:
        if _is_schedule_due(schedule):
            execute_push_analysis_schedule.delay(schedule.id)


def _is_schedule_due(schedule: Any) -> bool:
    """Check if a periodic schedule should run now."""
    if schedule.schedule_type == "one_time":
        return schedule.last_run_at is None

    if schedule.schedule_type != "periodic" or not schedule.crontab:
        return False

    try:
        from superset.tasks.cron_util import cron_schedule_window

        since = schedule.last_run_at or schedule.created_on
        dttm_list = cron_schedule_window(since, schedule.crontab, "UTC")
        return len(dttm_list) > 0
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Invalid crontab for schedule %s: %s", schedule.id, schedule.crontab
        )
        return False
