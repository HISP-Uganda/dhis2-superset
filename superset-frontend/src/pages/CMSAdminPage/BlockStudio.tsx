/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
/* eslint-disable no-restricted-imports, theme-colors/no-literal-colors, import/no-extraneous-dependencies */

import { useEffect, useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  BarChartOutlined,
  BorderOutlined,
  CodeOutlined,
  ColumnHeightOutlined,
  DashboardOutlined,
  DesktopOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  HighlightOutlined,
  LayoutOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
  PlusOutlined,
  NotificationOutlined,
  PaperClipOutlined,
  PictureOutlined,
  ProfileOutlined,
  SettingOutlined,
  TableOutlined,
  TabletOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { styled, t } from '@superset-ui/core';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
} from 'antd';
import {
  groupBlocksBySlot,
  RenderBlockTree,
} from 'src/pages/PublicLandingPage/BlockRenderer';
import {
  addRootBlock,
  createEmptyBlock,
  duplicateBlockByUid,
  ensurePageBlocks,
  flattenBlocks,
  insertBlockRelative,
  isContainerBlock,
  moveBlockByUid,
  removeBlockByUid,
  updateBlockByUid,
  updateBlockContent,
  updateBlockSettings,
} from 'src/pages/PublicLandingPage/blockUtils';
import type {
  PortalBlockDefinition,
  PortalChartSummary,
  PortalDashboardSummary,
  PortalMediaAsset,
  PortalNavigationMenu,
  PortalPage,
  PortalPageBlock,
  PortalPageSummary,
  PortalStyleBundle,
  PortalTemplate,
  PortalTheme,
} from 'src/pages/PublicLandingPage/types';
import RichTextComposer, { extractPlainText } from './RichTextComposer';

const StudioLayout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const Panel = styled.div`
  padding: 18px 20px;
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.18);
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
`;

const SectionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const CardButton = styled.button<{ $active?: boolean; $depth?: number }>`
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  margin-left: ${({ $depth = 0 }) => $depth * 12}px;
  border-radius: 14px;
  border: 1px solid
    ${({ $active }) =>
      $active ? 'rgba(15, 118, 110, 0.35)' : 'rgba(148, 163, 184, 0.22)'};
  background: ${({ $active }) =>
    $active ? 'rgba(15, 118, 110, 0.08)' : '#ffffff'};
  cursor: pointer;
`;

const TinyMeta = styled.div`
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 12px;
`;

const FieldBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const FieldLabel = styled.div`
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colorTextLabel};
`;

const StudioBar = styled(Panel)`
  position: sticky;
  top: 76px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
`;

const StudioBarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const StudioModeChip = styled.button<{ $active?: boolean }>`
  border: 1px solid
    ${({ $active }) =>
      $active ? 'rgba(15, 118, 110, 0.45)' : 'rgba(148, 163, 184, 0.22)'};
  border-radius: 999px;
  background: ${({ $active }) => ($active ? '#ccfbf1' : '#ffffff')};
  color: ${({ $active }) => ($active ? '#115e59' : '#334155')};
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
`;

const CanvasSurface = styled.div`
  padding: 28px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: #e2e8f0;
`;

const ViewportFrame = styled.div<{
  $mode: 'desktop' | 'tablet' | 'mobile';
}>`
  width: 100%;
  max-width: ${({ $mode }) =>
    $mode === 'mobile' ? '430px' : $mode === 'tablet' ? '820px' : '100%'};
  margin: 0 auto;
  transition: max-width 0.2s ease;
`;

const StudioViewport = styled.div`
  min-height: 72vh;
  padding: 32px;
  border-radius: 18px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.22);

  @media (max-width: 768px) {
    padding: 18px;
  }
`;

const RegionGrid = styled.div`
  display: grid;
  gap: 14px;
`;

const RegionCard = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
`;

const SlotLabel = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const DrawerStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const DrawerSection = styled(Panel)`
  padding: 14px 16px;
`;

const RegionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const RegionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
`;

const InlinePills = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

type BlockStudioProps = {
  draftPage: PortalPage | null;
  pages: PortalPageSummary[];
  charts: PortalChartSummary[];
  dashboards: PortalDashboardSummary[];
  mediaAssets: PortalMediaAsset[];
  navigationMenus?: {
    header: PortalNavigationMenu[];
    footer: PortalNavigationMenu[];
  };
  styleBundles: PortalStyleBundle[];
  themes: PortalTheme[];
  templates: PortalTemplate[];
  blockTypes?: PortalBlockDefinition[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelectPage: (pageSlug: string | null) => void;
  onNewPage: () => void;
  onChangeDraftPage: (nextPage: PortalPage) => void;
};

type Selection = { type: 'page' } | { type: 'block'; uid: string };

const SLOT_OPTIONS = [
  { value: 'header', label: t('Header') },
  { value: 'hero', label: t('Hero') },
  { value: 'content', label: t('Content') },
  { value: 'sidebar', label: t('Sidebar') },
  { value: 'cta', label: t('CTA') },
  { value: 'footer', label: t('Footer') },
] as const;

const PAGE_TYPE_OPTIONS = [
  { value: 'content', label: t('Standard Page') },
  { value: 'landing', label: t('Landing Page') },
  { value: 'dashboard', label: t('Dashboard Page') },
  { value: 'documentation', label: t('Documentation') },
  { value: 'faq', label: t('FAQ') },
  { value: 'policy', label: t('Policy') },
  { value: 'utility', label: t('Utility') },
] as const;

const PREVIEW_VIEWPORTS = [
  { value: 'desktop', label: t('Desktop') },
  { value: 'tablet', label: t('Tablet') },
  { value: 'mobile', label: t('Mobile') },
] as const;

function blockKey(block: PortalPageBlock) {
  return block.uid || String(block.id);
}

function blockIcon(type?: string, iconName?: string | null) {
  const resolved = iconName || type || 'paragraph';
  switch (resolved) {
    case 'layout':
    case 'section':
    case 'group':
    case 'columns':
    case 'column':
    case 'hero':
    case 'card':
      return <LayoutOutlined />;
    case 'paragraph':
    case 'rich_text':
    case 'heading':
    case 'title':
    case 'font-size':
      return <FontSizeOutlined />;
    case 'list':
    case 'unordered-list':
      return <ProfileOutlined />;
    case 'quote':
    case 'highlight':
    case 'callout':
      return <HighlightOutlined />;
    case 'picture':
    case 'image':
    case 'gallery':
      return <PictureOutlined />;
    case 'video':
    case 'video-camera':
    case 'embed':
      return <VideoCameraOutlined />;
    case 'paper-clip':
    case 'file':
    case 'download':
      return <PaperClipOutlined />;
    case 'button':
    case 'link':
      return <LinkOutlined />;
    case 'divider':
    case 'minus':
      return <BorderOutlined />;
    case 'spacer':
    case 'column-height':
      return <ColumnHeightOutlined />;
    case 'chart':
    case 'bar-chart':
      return <BarChartOutlined />;
    case 'dashboard':
      return <DashboardOutlined />;
    case 'table':
      return <TableOutlined />;
    case 'page_title':
    case 'breadcrumb':
    case 'menu':
      return <MenuOutlined />;
    case 'dynamic_widget':
      return <AppstoreOutlined />;
    case 'html':
    case 'code':
      return <CodeOutlined />;
    case 'statistic':
      return <NotificationOutlined />;
    case 'file-image':
      return <FileImageOutlined />;
    case 'file-outlined':
      return <FileOutlined />;
    default:
      return <FileTextOutlined />;
  }
}

const FALLBACK_BLOCK_TYPES: PortalBlockDefinition[] = [
  {
    type: 'section',
    label: t('Section'),
    category: 'layout',
    is_container: true,
  },
  {
    type: 'group',
    label: t('Group'),
    category: 'layout',
    is_container: true,
  },
  {
    type: 'columns',
    label: t('Columns'),
    category: 'layout',
    is_container: true,
  },
  {
    type: 'column',
    label: t('Column'),
    category: 'layout',
    is_container: true,
  },
  {
    type: 'hero',
    label: t('Hero'),
    category: 'layout',
    is_container: true,
  },
  {
    type: 'card',
    label: t('Card'),
    category: 'layout',
    is_container: true,
  },
  {
    type: 'rich_text',
    label: t('Rich Text'),
    category: 'text',
    is_container: false,
  },
  {
    type: 'paragraph',
    label: t('Paragraph'),
    category: 'text',
    is_container: false,
  },
  {
    type: 'heading',
    label: t('Heading'),
    category: 'text',
    is_container: false,
  },
  {
    type: 'list',
    label: t('List'),
    category: 'text',
    is_container: false,
  },
  {
    type: 'quote',
    label: t('Quote'),
    category: 'text',
    is_container: false,
  },
  {
    type: 'image',
    label: t('Image'),
    category: 'media',
    is_container: false,
  },
  {
    type: 'gallery',
    label: t('Gallery'),
    category: 'media',
    is_container: false,
  },
  {
    type: 'video',
    label: t('Video'),
    category: 'media',
    is_container: false,
  },
  {
    type: 'embed',
    label: t('Embed'),
    category: 'media',
    is_container: false,
  },
  {
    type: 'file',
    label: t('File'),
    category: 'media',
    is_container: false,
  },
  {
    type: 'download',
    label: t('Download'),
    category: 'media',
    is_container: false,
  },
  {
    type: 'button',
    label: t('Button'),
    category: 'design',
    is_container: false,
  },
  {
    type: 'divider',
    label: t('Divider'),
    category: 'design',
    is_container: false,
  },
  {
    type: 'spacer',
    label: t('Spacer'),
    category: 'design',
    is_container: false,
  },
  {
    type: 'callout',
    label: t('Callout'),
    category: 'design',
    is_container: false,
  },
  {
    type: 'chart',
    label: t('Chart'),
    category: 'data',
    is_container: false,
  },
  {
    type: 'dashboard',
    label: t('Dashboard'),
    category: 'data',
    is_container: false,
  },
  {
    type: 'table',
    label: t('Table'),
    category: 'data',
    is_container: false,
  },
  {
    type: 'statistic',
    label: t('Statistic'),
    category: 'data',
    is_container: false,
  },
  {
    type: 'dynamic_widget',
    label: t('Dynamic Widget'),
    category: 'data',
    is_container: false,
  },
  {
    type: 'page_title',
    label: t('Page Title'),
    category: 'utility',
    is_container: false,
  },
  {
    type: 'breadcrumb',
    label: t('Breadcrumb'),
    category: 'utility',
    is_container: false,
  },
  {
    type: 'menu',
    label: t('Menu'),
    category: 'utility',
    is_container: false,
  },
  {
    type: 'html',
    label: t('HTML'),
    category: 'advanced',
    is_container: false,
  },
];

function formatGalleryImages(images?: Array<Record<string, any>>) {
  return (images || [])
    .map(image =>
      [image?.url || '', image?.alt || '', image?.caption || ''].join(' | '),
    )
    .join('\n');
}

function parseGalleryImages(rawValue: string) {
  return rawValue
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [url, alt = '', caption = ''] = line
        .split('|')
        .map(part => part.trim());
      return { url, alt, caption };
    });
}

function formatTableColumns(columns?: string[]) {
  return (columns || []).join(', ');
}

function parseTableColumns(rawValue: string) {
  return rawValue
    .split(',')
    .map(column => column.trim())
    .filter(Boolean);
}

function formatTableRows(rows?: string[][]) {
  return (rows || []).map(row => row.join(' | ')).join('\n');
}

function parseTableRows(rawValue: string) {
  return rawValue
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split('|').map(cell => cell.trim()));
}

function viewportIcon(mode: 'desktop' | 'tablet' | 'mobile') {
  switch (mode) {
    case 'tablet':
      return <TabletOutlined />;
    case 'mobile':
      return <ColumnHeightOutlined rotate={90} />;
    case 'desktop':
    default:
      return <DesktopOutlined />;
  }
}

function richTextValue(
  block: PortalPageBlock | null,
  fallback = t('No content yet.'),
) {
  if (!block) {
    return '';
  }
  return (
    block.content?.html ||
    block.content?.body_html ||
    block.content?.body ||
    block.content?.quote ||
    fallback
  );
}

export default function BlockStudio({
  draftPage,
  pages,
  charts,
  dashboards,
  mediaAssets,
  navigationMenus = { header: [], footer: [] },
  styleBundles,
  themes,
  templates,
  blockTypes = [],
  search,
  onSearchChange,
  onSelectPage,
  onNewPage,
  onChangeDraftPage,
}: BlockStudioProps) {
  const [selection, setSelection] = useState<Selection>({ type: 'page' });
  const [quickInsertType, setQuickInsertType] = useState('paragraph');
  const [quickInsertSlot, setQuickInsertSlot] = useState<string>('content');
  const [previewViewport, setPreviewViewport] = useState<
    'desktop' | 'tablet' | 'mobile'
  >('desktop');
  const [canvasMode, setCanvasMode] = useState<'compose' | 'preview'>(
    'compose',
  );
  const [documentOpen, setDocumentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const blocks = useMemo(() => ensurePageBlocks(draftPage), [draftPage]);
  const slotGroups = useMemo(() => groupBlocksBySlot(blocks), [blocks]);
  const flattenedBlocks = useMemo(() => flattenBlocks(blocks), [blocks]);
  const selectionKey = selection.type === 'block' ? selection.uid : 'page';
  const hasDraftPage = Boolean(draftPage);
  const isPublishedPage = Boolean(draftPage?.is_published);
  const selectedBlock =
    selection.type === 'block'
      ? flattenedBlocks.find(({ block }) => blockKey(block) === selection.uid)
          ?.block || null
      : null;
  const filteredPages = useMemo(
    () =>
      (pages || []).filter(page => {
        const haystack = `${page.title} ${page.slug || ''}`.toLowerCase();
        return haystack.includes(search.toLowerCase());
      }),
    [pages, search],
  );
  const mediaOptions = useMemo(
    () =>
      (mediaAssets || []).map(asset => ({
        value: asset.id,
        label: `${asset.title} · ${asset.asset_type || 'file'}`,
      })),
    [mediaAssets],
  );
  const menuOptions = useMemo(
    () =>
      [
        ...(navigationMenus.header || []),
        ...(navigationMenus.footer || []),
      ].map(menu => ({
        value: menu.slug,
        label: `${menu.title} · ${menu.location}`,
      })),
    [navigationMenus],
  );
  const insertableBlockTypes = blockTypes.length
    ? blockTypes
    : FALLBACK_BLOCK_TYPES;

  useEffect(() => {
    setSelection({ type: 'page' });
  }, [draftPage?.id]);

  useEffect(() => {
    if (selection.type === 'block' && !selectedBlock) {
      setSelection({ type: 'page' });
    }
  }, [selectedBlock, selection.type]);

  useEffect(() => {
    if (hasDraftPage) {
      setSettingsOpen(true);
    }
  }, [draftPage?.id, hasDraftPage, selection.type, selectionKey]);

  function pushBlocks(nextBlocks: PortalPageBlock[]) {
    if (!draftPage || isPublishedPage) {
      return;
    }
    onChangeDraftPage({
      ...draftPage,
      blocks: nextBlocks,
    });
  }

  function updatePage(patch: Partial<PortalPage>) {
    if (!draftPage || isPublishedPage) {
      return;
    }
    onChangeDraftPage({
      ...draftPage,
      ...patch,
      blocks,
    });
  }

  function updatePageRichText(field: 'description' | 'excerpt', html: string) {
    updatePage({
      [field]: field === 'excerpt' ? extractPlainText(html) : html,
    } as Partial<PortalPage>);
  }

  function addBlock(blockType: string) {
    if (!draftPage || isPublishedPage) {
      return;
    }
    const targetUid = selection.type === 'block' ? selection.uid : null;
    let nextBlocks = targetUid
      ? insertBlockRelative(
          blocks,
          targetUid,
          blockType,
          selectedBlock && isContainerBlock(selectedBlock.block_type)
            ? 'child'
            : 'after',
        )
      : addRootBlock(blocks, blockType);
    const existingKeys = new Set(
      flattenedBlocks.map(({ block }) => blockKey(block)),
    );
    let insertedBlock = flattenBlocks(nextBlocks)
      .map(({ block }) => block)
      .find(block => !existingKeys.has(blockKey(block)));
    if (insertedBlock) {
      const insertedKey = blockKey(insertedBlock);
      const resolvedSlot =
        selectedBlock?.slot ||
        quickInsertSlot ||
        insertedBlock.slot ||
        'content';
      nextBlocks = updateBlockByUid(nextBlocks, insertedKey, {
        slot: resolvedSlot,
      });
      insertedBlock =
        flattenBlocks(nextBlocks)
          .map(({ block }) => block)
          .find(block => blockKey(block) === insertedKey) || insertedBlock;
    }
    pushBlocks(nextBlocks);
    if (insertedBlock) {
      setSelection({ type: 'block', uid: blockKey(insertedBlock) });
    }
  }

  function updateSelectedBlock(patch: Partial<PortalPageBlock>) {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    pushBlocks(updateBlockByUid(blocks, blockKey(selectedBlock), patch));
  }

  function updateSelectedBlockContent(patch: Record<string, any>) {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    pushBlocks(updateBlockContent(blocks, blockKey(selectedBlock), patch));
  }

  function updateSelectedRichText(
    html: string,
    field: 'body' | 'quote' = 'body',
  ) {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    const plainText = extractPlainText(html);
    if (field === 'quote') {
      updateSelectedBlockContent({
        html,
        body_html: html,
        quote: plainText,
      });
      return;
    }
    updateSelectedBlockContent({
      html,
      body_html: html,
      body: plainText,
    });
  }

  function updateRichTextBlock(
    block: PortalPageBlock,
    html: string,
    field: 'body' | 'quote' = 'body',
  ) {
    if (isPublishedPage) {
      return;
    }
    const plainText = extractPlainText(html);
    const patch =
      field === 'quote'
        ? {
            html,
            body_html: html,
            quote: plainText,
          }
        : {
            html,
            body_html: html,
            body: plainText,
          };
    pushBlocks(updateBlockContent(blocks, blockKey(block), patch));
    setSelection({ type: 'block', uid: blockKey(block) });
  }

  function updateSelectedBlockSettings(patch: Record<string, any>) {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    pushBlocks(updateBlockSettings(blocks, blockKey(selectedBlock), patch));
  }

  function removeSelectedBlock() {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    pushBlocks(removeBlockByUid(blocks, blockKey(selectedBlock)));
    setSelection({ type: 'page' });
  }

  function duplicateSelectedBlock() {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    pushBlocks(duplicateBlockByUid(blocks, blockKey(selectedBlock)));
  }

  function moveSelectedBlock(direction: -1 | 1) {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    pushBlocks(moveBlockByUid(blocks, blockKey(selectedBlock), direction));
  }

  function resizeSelectedBlock(
    axis: 'gridSpan' | 'minHeight',
    direction: -1 | 1,
  ) {
    if (!selectedBlock || isPublishedPage) {
      return;
    }
    if (axis === 'gridSpan') {
      const currentSpan = Number(selectedBlock.settings?.gridSpan) || 12;
      updateSelectedBlockSettings({
        gridSpan: Math.min(Math.max(currentSpan + direction, 1), 12),
      });
      return;
    }
    const currentHeight = Number(selectedBlock.settings?.minHeight) || 0;
    updateSelectedBlockSettings({
      minHeight: Math.max(currentHeight + direction * 40, 0),
    });
  }

  const quickInsertLabel =
    selection.type === 'block'
      ? selectedBlock && isContainerBlock(selectedBlock.block_type)
        ? t('Add Child')
        : t('Add After')
      : t('Add Content');

  function renderInspector() {
    if (!draftPage) {
      return <Empty description={t('Choose a page or create a new one.')} />;
    }
    if (!selectedBlock) {
      return (
        <SectionList>
          {isPublishedPage ? (
            <Alert
              showIcon
              type="info"
              message={t(
                'Published pages are read-only. Unpublish to edit content.',
              )}
            />
          ) : null}
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Title')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={draftPage.title}
                onChange={event => updatePage({ title: event.target.value })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Slug')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={draftPage.slug || ''}
                onChange={event => updatePage({ slug: event.target.value })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Path Label')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={draftPage.navigation_label || ''}
                onChange={event =>
                  updatePage({ navigation_label: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Display Order')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                min={0}
                value={draftPage.display_order ?? 0}
                onChange={value =>
                  updatePage({ display_order: Number(value) || 0 })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Parent Page')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                allowClear
                value={draftPage.parent_page_id || undefined}
                options={(pages || [])
                  .filter(page => page.id !== draftPage.id)
                  .map(page => ({
                    value: page.id,
                    label: page.path || page.slug || page.title,
                  }))}
                onChange={value =>
                  updatePage({
                    parent_page_id: value || null,
                    parent_page: pages.find(page => page.id === value) || null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Page Type')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                value={draftPage.page_type || 'content'}
                options={PAGE_TYPE_OPTIONS.map(option => ({
                  value: option.value,
                  label: option.label,
                }))}
                onChange={value => updatePage({ page_type: value })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Subtitle')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={draftPage.subtitle || ''}
                onChange={event => updatePage({ subtitle: event.target.value })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Visibility')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                value={draftPage.visibility || 'draft'}
                onChange={value => updatePage({ visibility: value })}
                options={[
                  { value: 'draft', label: t('Draft') },
                  { value: 'authenticated', label: t('Authenticated') },
                  { value: 'public', label: t('Public') },
                ]}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Theme')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                allowClear
                value={draftPage.theme_id || undefined}
                options={themes.map(theme => ({
                  value: theme.id,
                  label: theme.title,
                }))}
                onChange={value =>
                  updatePage({
                    theme_id: value || null,
                    theme: themes.find(theme => theme.id === value) || null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Template')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                allowClear
                value={draftPage.template_id || undefined}
                options={templates.map(template => ({
                  value: template.id,
                  label: template.title,
                }))}
                onChange={value =>
                  updatePage({
                    template_id: value || null,
                    template:
                      templates.find(template => template.id === value) || null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Style Bundle')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                allowClear
                value={draftPage.style_bundle_id || undefined}
                options={styleBundles.map(bundle => ({
                  value: bundle.id,
                  label: bundle.title,
                }))}
                onChange={value =>
                  updatePage({
                    style_bundle_id: value || null,
                    style_bundle:
                      styleBundles.find(bundle => bundle.id === value) || null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Published')}</FieldLabel>
              <Switch
                disabled={isPublishedPage}
                checked={draftPage.is_published}
                onChange={checked => updatePage({ is_published: checked })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Homepage')}</FieldLabel>
              <Switch
                disabled={isPublishedPage}
                checked={draftPage.is_homepage}
                onChange={checked => updatePage({ is_homepage: checked })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Template Key')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={draftPage.template_key || ''}
                onChange={event =>
                  updatePage({ template_key: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Scheduled Publish')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                type="datetime-local"
                value={
                  draftPage.scheduled_publish_at
                    ? draftPage.scheduled_publish_at.slice(0, 16)
                    : ''
                }
                onChange={event =>
                  updatePage({
                    scheduled_publish_at: event.target.value
                      ? new Date(event.target.value).toISOString()
                      : null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Featured Image')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                allowClear
                showSearch
                optionFilterProp="label"
                value={draftPage.featured_image_asset_id || undefined}
                options={mediaOptions.filter(option => {
                  const asset = mediaAssets.find(
                    item => item.id === option.value,
                  );
                  return asset?.asset_type === 'image';
                })}
                onChange={value =>
                  updatePage({
                    featured_image_asset_id: value || null,
                    featured_image_asset:
                      mediaAssets.find(asset => asset.id === value) || null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('OG Image')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                allowClear
                showSearch
                optionFilterProp="label"
                value={draftPage.og_image_asset_id || undefined}
                options={mediaOptions.filter(option => {
                  const asset = mediaAssets.find(
                    item => item.id === option.value,
                  );
                  return asset?.asset_type === 'image';
                })}
                onChange={value =>
                  updatePage({
                    og_image_asset_id: value || null,
                    og_image_asset:
                      mediaAssets.find(asset => asset.id === value) || null,
                  })
                }
              />
            </FieldBlock>
          </FieldGrid>
          <FieldBlock>
            <FieldLabel>{t('Excerpt')}</FieldLabel>
            <Input.TextArea
              disabled={isPublishedPage}
              rows={3}
              value={draftPage.excerpt || ''}
              onChange={event => updatePage({ excerpt: event.target.value })}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t('Description')}</FieldLabel>
            <RichTextComposer
              readOnly={isPublishedPage}
              minHeight={180}
              value={draftPage.description || ''}
              helperText={t(
                'Formatted page descriptions are shown in studio and preview surfaces.',
              )}
              onChange={value => updatePageRichText('description', value)}
            />
          </FieldBlock>
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('SEO Title')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={draftPage.seo_title || ''}
                onChange={event =>
                  updatePage({ seo_title: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('SEO Description')}</FieldLabel>
              <Input.TextArea
                disabled={isPublishedPage}
                rows={3}
                value={draftPage.seo_description || ''}
                onChange={event =>
                  updatePage({ seo_description: event.target.value })
                }
              />
            </FieldBlock>
          </FieldGrid>
          <TinyMeta>
            {t('Public path')}: /superset/public/
            {draftPage.path || draftPage.slug || t('page-slug')}/
          </TinyMeta>
          {draftPage.parent_page ? (
            <TinyMeta>
              {t('Parent')}:{' '}
              {draftPage.parent_page.title || draftPage.parent_page.slug}
            </TinyMeta>
          ) : null}
        </SectionList>
      );
    }

    return (
      <SectionList>
        {isPublishedPage ? (
          <Alert
            showIcon
            type="info"
            message={t(
              'Published pages are read-only. Unpublish to edit content.',
            )}
          />
        ) : null}
        <FieldGrid>
          <FieldBlock>
            <FieldLabel>{t('Block Type')}</FieldLabel>
            <Select
              disabled={isPublishedPage}
              value={selectedBlock.block_type}
              options={insertableBlockTypes.map(definition => ({
                value: definition.type,
                label: definition.label,
              }))}
              onChange={value => {
                const nextDefinition = createEmptyBlock(value);
                updateSelectedBlock({
                  block_type: nextDefinition.block_type,
                  is_container: nextDefinition.is_container,
                  content: nextDefinition.content,
                  settings: {
                    ...selectedBlock.settings,
                    ...nextDefinition.settings,
                  },
                  styles: nextDefinition.styles,
                  metadata: {
                    ...selectedBlock.metadata,
                    ...nextDefinition.metadata,
                  },
                  children:
                    nextDefinition.is_container ||
                    !selectedBlock.children.length
                      ? selectedBlock.children
                      : [],
                });
              }}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t('Slot')}</FieldLabel>
            <Select
              disabled={isPublishedPage}
              value={selectedBlock.slot || 'content'}
              onChange={value => updateSelectedBlock({ slot: value })}
              options={SLOT_OPTIONS.map(option => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </FieldBlock>
        </FieldGrid>
        <FieldGrid>
          <FieldBlock>
            <FieldLabel>{t('Status')}</FieldLabel>
            <Select
              disabled={isPublishedPage}
              value={selectedBlock.status || 'active'}
              onChange={value => updateSelectedBlock({ status: value })}
              options={[
                { value: 'active', label: t('Active') },
                { value: 'hidden', label: t('Hidden') },
              ]}
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t('Style Bundle')}</FieldLabel>
            <Select
              disabled={isPublishedPage}
              allowClear
              value={selectedBlock.style_bundle_id || undefined}
              options={styleBundles.map(bundle => ({
                value: bundle.id,
                label: bundle.title,
              }))}
              onChange={value =>
                updateSelectedBlock({ style_bundle_id: value || null })
              }
            />
          </FieldBlock>
        </FieldGrid>
        <FieldGrid>
          <FieldBlock>
            <FieldLabel>{t('Label')}</FieldLabel>
            <Input
              disabled={isPublishedPage}
              value={selectedBlock.metadata?.label || ''}
              onChange={event =>
                updateSelectedBlock({
                  metadata: {
                    ...(selectedBlock.metadata || {}),
                    label: event.target.value,
                  },
                })
              }
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t('Column Span')}</FieldLabel>
            <InputNumber
              disabled={isPublishedPage}
              style={{ width: '100%' }}
              min={1}
              max={12}
              value={Number(selectedBlock.settings?.gridSpan) || 12}
              onChange={value =>
                updateSelectedBlockSettings({
                  gridSpan: Math.min(Math.max(Number(value) || 12, 1), 12),
                })
              }
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t('Min Height')}</FieldLabel>
            <InputNumber
              disabled={isPublishedPage}
              style={{ width: '100%' }}
              min={0}
              step={40}
              value={Number(selectedBlock.settings?.minHeight) || 0}
              onChange={value =>
                updateSelectedBlockSettings({
                  minHeight: Math.max(Number(value) || 0, 0),
                })
              }
            />
          </FieldBlock>
        </FieldGrid>
        {(selectedBlock.block_type === 'rich_text' ||
          selectedBlock.block_type === 'paragraph' ||
          selectedBlock.block_type === 'card' ||
          selectedBlock.block_type === 'group' ||
          selectedBlock.block_type === 'section' ||
          selectedBlock.block_type === 'callout') && (
          <FieldBlock>
            <FieldLabel>{t('Body')}</FieldLabel>
            <RichTextComposer
              readOnly={isPublishedPage}
              minHeight={selectedBlock.block_type === 'rich_text' ? 220 : 180}
              value={richTextValue(selectedBlock)}
              onChange={value => updateSelectedRichText(value)}
            />
          </FieldBlock>
        )}
        {(selectedBlock.block_type === 'heading' ||
          selectedBlock.block_type === 'hero' ||
          selectedBlock.block_type === 'card' ||
          selectedBlock.block_type === 'group' ||
          selectedBlock.block_type === 'section' ||
          selectedBlock.block_type === 'chart' ||
          selectedBlock.block_type === 'dashboard' ||
          selectedBlock.block_type === 'dynamic_widget' ||
          selectedBlock.block_type === 'callout' ||
          selectedBlock.block_type === 'statistic' ||
          selectedBlock.block_type === 'file' ||
          selectedBlock.block_type === 'download') && (
          <FieldBlock>
            <FieldLabel>{t('Title')}</FieldLabel>
            <Input
              disabled={isPublishedPage}
              value={selectedBlock.content?.title || ''}
              onChange={event =>
                updateSelectedBlockContent({ title: event.target.value })
              }
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'heading' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Text')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.content?.text || ''}
                onChange={event =>
                  updateSelectedBlockContent({ text: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Level')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                min={1}
                max={6}
                value={Number(selectedBlock.content?.level) || 2}
                onChange={value =>
                  updateSelectedBlockContent({ level: Number(value) || 2 })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'hero' && (
          <FieldBlock>
            <FieldLabel>{t('Subtitle')}</FieldLabel>
            <Input.TextArea
              disabled={isPublishedPage}
              rows={3}
              value={selectedBlock.content?.subtitle || ''}
              onChange={event =>
                updateSelectedBlockContent({ subtitle: event.target.value })
              }
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'list' && (
          <FieldBlock>
            <FieldLabel>{t('Items')}</FieldLabel>
            <Input.TextArea
              disabled={isPublishedPage}
              rows={6}
              value={selectedBlock.content?.items || ''}
              onChange={event =>
                updateSelectedBlockContent({ items: event.target.value })
              }
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'quote' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Quote')}</FieldLabel>
              <RichTextComposer
                readOnly={isPublishedPage}
                minHeight={140}
                value={richTextValue(
                  selectedBlock,
                  selectedBlock.content?.quote,
                )}
                onChange={value => updateSelectedRichText(value, 'quote')}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Citation')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.content?.citation || ''}
                onChange={event =>
                  updateSelectedBlockContent({ citation: event.target.value })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'image' && (
          <SectionList>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Image Asset')}</FieldLabel>
                <Select
                  disabled={isPublishedPage}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  value={
                    selectedBlock.settings?.asset_ref?.id ||
                    selectedBlock.content?.asset?.id ||
                    undefined
                  }
                  options={mediaOptions.filter(option => {
                    const asset = mediaAssets.find(
                      item => item.id === option.value,
                    );
                    return asset?.asset_type === 'image';
                  })}
                  onChange={value =>
                    updateSelectedBlockSettings({
                      asset_ref: value ? { id: value } : null,
                    })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Image URL')}</FieldLabel>
                <Input
                  disabled={isPublishedPage}
                  value={selectedBlock.content?.url || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ url: event.target.value })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Alt Text')}</FieldLabel>
                <Input
                  disabled={isPublishedPage}
                  value={selectedBlock.content?.alt || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ alt: event.target.value })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Caption')}</FieldLabel>
                <Input
                  disabled={isPublishedPage}
                  value={selectedBlock.content?.caption || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ caption: event.target.value })
                  }
                />
              </FieldBlock>
            </FieldGrid>
          </SectionList>
        )}
        {selectedBlock.block_type === 'gallery' && (
          <SectionList>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Columns')}</FieldLabel>
                <InputNumber
                  disabled={isPublishedPage}
                  style={{ width: '100%' }}
                  min={1}
                  max={6}
                  value={Number(selectedBlock.settings?.columns) || 3}
                  onChange={value =>
                    updateSelectedBlockSettings({
                      columns: Number(value) || 3,
                    })
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Images')}</FieldLabel>
              <Input.TextArea
                disabled={isPublishedPage}
                rows={6}
                value={formatGalleryImages(selectedBlock.content?.images)}
                onChange={event =>
                  updateSelectedBlockContent({
                    images: parseGalleryImages(event.target.value),
                  })
                }
                placeholder={t('One image per line: URL | Alt text | Caption')}
              />
            </FieldBlock>
          </SectionList>
        )}
        {(selectedBlock.block_type === 'embed' ||
          selectedBlock.block_type === 'video') && (
          <SectionList>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Title')}</FieldLabel>
                <Input
                  disabled={isPublishedPage}
                  value={selectedBlock.content?.title || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ title: event.target.value })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('URL')}</FieldLabel>
                <Input
                  disabled={isPublishedPage}
                  value={selectedBlock.content?.url || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ url: event.target.value })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Caption')}</FieldLabel>
                <Input
                  disabled={isPublishedPage}
                  value={selectedBlock.content?.caption || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ caption: event.target.value })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Height')}</FieldLabel>
                <InputNumber
                  disabled={isPublishedPage}
                  style={{ width: '100%' }}
                  min={120}
                  value={Number(selectedBlock.settings?.height) || 360}
                  onChange={value =>
                    updateSelectedBlockSettings({
                      height: Number(value) || 360,
                    })
                  }
                />
              </FieldBlock>
            </FieldGrid>
          </SectionList>
        )}
        {(selectedBlock.block_type === 'file' ||
          selectedBlock.block_type === 'download') && (
          <SectionList>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('File Asset')}</FieldLabel>
                <Select
                  disabled={isPublishedPage}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  value={
                    selectedBlock.settings?.asset_ref?.id ||
                    selectedBlock.content?.asset?.id ||
                    undefined
                  }
                  options={mediaOptions}
                  onChange={value =>
                    updateSelectedBlockSettings({
                      asset_ref: value ? { id: value } : null,
                    })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Button Label')}</FieldLabel>
                <Input
                  disabled={isPublishedPage}
                  value={
                    selectedBlock.content?.buttonLabel ||
                    selectedBlock.content?.label ||
                    ''
                  }
                  onChange={event =>
                    updateSelectedBlockContent({
                      buttonLabel: event.target.value,
                    })
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Description')}</FieldLabel>
              <RichTextComposer
                readOnly={isPublishedPage}
                minHeight={160}
                value={richTextValue(selectedBlock)}
                onChange={value => updateSelectedRichText(value)}
              />
            </FieldBlock>
          </SectionList>
        )}
        {selectedBlock.block_type === 'button' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Label')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.content?.label || ''}
                onChange={event =>
                  updateSelectedBlockContent({ label: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('URL')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.settings?.url || ''}
                onChange={event =>
                  updateSelectedBlockSettings({ url: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Variant')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                value={selectedBlock.settings?.variant || 'primary'}
                onChange={value =>
                  updateSelectedBlockSettings({ variant: value })
                }
                options={[
                  { value: 'primary', label: t('Primary') },
                  { value: 'default', label: t('Default') },
                  { value: 'dashed', label: t('Dashed') },
                  { value: 'link', label: t('Link') },
                  { value: 'text', label: t('Text') },
                ]}
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'chart' && (
          <>
            <FieldBlock>
              <FieldLabel>{t('Chart')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                showSearch
                optionFilterProp="label"
                value={selectedBlock.settings?.chart_ref?.id || undefined}
                options={charts.map(chart => ({
                  value: chart.id,
                  label: `${chart.slice_name} (${chart.viz_type || t('Chart')})`,
                }))}
                onChange={value =>
                  updateSelectedBlockSettings({
                    chart_ref: value ? { id: value } : null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Caption')}</FieldLabel>
              <Input.TextArea
                disabled={isPublishedPage}
                rows={3}
                value={selectedBlock.content?.caption || ''}
                onChange={event =>
                  updateSelectedBlockContent({ caption: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Height')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                value={Number(selectedBlock.settings?.height) || 360}
                onChange={value =>
                  updateSelectedBlockSettings({ height: Number(value) || 360 })
                }
              />
            </FieldBlock>
          </>
        )}
        {selectedBlock.block_type === 'dashboard' && (
          <>
            <FieldBlock>
              <FieldLabel>{t('Dashboard')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                value={selectedBlock.settings?.dashboard_ref?.id || undefined}
                options={dashboards.map(dashboard => ({
                  value: dashboard.id,
                  label: dashboard.dashboard_title,
                }))}
                onChange={value =>
                  updateSelectedBlockSettings({
                    dashboard_ref: value ? { id: value } : null,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Height')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                value={Number(selectedBlock.settings?.height) || 720}
                onChange={value =>
                  updateSelectedBlockSettings({ height: Number(value) || 720 })
                }
              />
            </FieldBlock>
          </>
        )}
        {selectedBlock.block_type === 'columns' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Column Count')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                min={2}
                max={4}
                value={Number(selectedBlock.settings?.columnCount) || 2}
                onChange={value =>
                  updateSelectedBlockSettings({
                    columnCount: Number(value) || 2,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Gap')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                value={Number(selectedBlock.settings?.gap) || 24}
                onChange={value =>
                  updateSelectedBlockSettings({ gap: Number(value) || 24 })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'section' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Anchor')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.settings?.anchor || ''}
                onChange={event =>
                  updateSelectedBlockSettings({ anchor: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Background')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.settings?.background || ''}
                onChange={event =>
                  updateSelectedBlockSettings({
                    background: event.target.value,
                  })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Columns')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                min={1}
                max={4}
                value={Number(selectedBlock.settings?.columns) || 1}
                onChange={value =>
                  updateSelectedBlockSettings({ columns: Number(value) || 1 })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Container')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                value={selectedBlock.settings?.container || 'default'}
                onChange={value =>
                  updateSelectedBlockSettings({ container: value })
                }
                options={[
                  { value: 'default', label: t('Default') },
                  { value: 'full', label: t('Full Width') },
                  { value: 'narrow', label: t('Narrow') },
                ]}
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'table' && (
          <SectionList>
            <FieldBlock>
              <FieldLabel>{t('Title')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.content?.title || ''}
                onChange={event =>
                  updateSelectedBlockContent({ title: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Columns')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={formatTableColumns(selectedBlock.content?.columns)}
                onChange={event =>
                  updateSelectedBlockContent({
                    columns: parseTableColumns(event.target.value),
                  })
                }
                placeholder={t('Comma-separated column titles')}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Rows')}</FieldLabel>
              <Input.TextArea
                disabled={isPublishedPage}
                rows={6}
                value={formatTableRows(selectedBlock.content?.rows)}
                onChange={event =>
                  updateSelectedBlockContent({
                    rows: parseTableRows(event.target.value),
                  })
                }
                placeholder={t('One row per line. Separate cells with |')}
              />
            </FieldBlock>
          </SectionList>
        )}
        {selectedBlock.block_type === 'dynamic_widget' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Widget Type')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                value={
                  selectedBlock.settings?.widgetType || 'indicator_highlights'
                }
                onChange={value =>
                  updateSelectedBlockSettings({ widgetType: value })
                }
                options={[
                  {
                    value: 'indicator_highlights',
                    label: t('Indicator Highlights'),
                  },
                  { value: 'dashboard_list', label: t('Dashboard List') },
                ]}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Limit')}</FieldLabel>
              <InputNumber
                disabled={isPublishedPage}
                style={{ width: '100%' }}
                min={1}
                max={24}
                value={Number(selectedBlock.settings?.limit) || 6}
                onChange={value =>
                  updateSelectedBlockSettings({ limit: Number(value) || 6 })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'page_title' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Show Subtitle')}</FieldLabel>
              <Switch
                disabled={isPublishedPage}
                checked={selectedBlock.settings?.showSubtitle !== false}
                onChange={checked =>
                  updateSelectedBlockSettings({ showSubtitle: checked })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Show Excerpt')}</FieldLabel>
              <Switch
                disabled={isPublishedPage}
                checked={selectedBlock.settings?.showExcerpt === true}
                onChange={checked =>
                  updateSelectedBlockSettings({ showExcerpt: checked })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'breadcrumb' && (
          <FieldBlock>
            <FieldLabel>{t('Show Current Page')}</FieldLabel>
            <Switch
              disabled={isPublishedPage}
              checked={selectedBlock.settings?.showCurrentPage !== false}
              onChange={checked =>
                updateSelectedBlockSettings({ showCurrentPage: checked })
              }
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'menu' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Menu')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                allowClear
                value={selectedBlock.settings?.menu_slug || undefined}
                options={menuOptions}
                onChange={value =>
                  updateSelectedBlockSettings({ menu_slug: value || null })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Orientation')}</FieldLabel>
              <Select
                disabled={isPublishedPage}
                value={selectedBlock.settings?.orientation || 'horizontal'}
                onChange={value =>
                  updateSelectedBlockSettings({ orientation: value })
                }
                options={[
                  { value: 'horizontal', label: t('Horizontal') },
                  { value: 'vertical', label: t('Vertical') },
                ]}
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'callout' && (
          <FieldBlock>
            <FieldLabel>{t('Tone')}</FieldLabel>
            <Select
              disabled={isPublishedPage}
              value={selectedBlock.settings?.tone || 'info'}
              onChange={value => updateSelectedBlockSettings({ tone: value })}
              options={[
                { value: 'info', label: t('Info') },
                { value: 'success', label: t('Success') },
                { value: 'warning', label: t('Warning') },
                { value: 'error', label: t('Error') },
              ]}
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'statistic' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Value')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.content?.value || ''}
                onChange={event =>
                  updateSelectedBlockContent({ value: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Caption')}</FieldLabel>
              <Input
                disabled={isPublishedPage}
                value={selectedBlock.content?.caption || ''}
                onChange={event =>
                  updateSelectedBlockContent({ caption: event.target.value })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'divider' && (
          <FieldBlock>
            <FieldLabel>{t('Style')}</FieldLabel>
            <Select
              disabled={isPublishedPage}
              value={selectedBlock.settings?.style || 'solid'}
              onChange={value => updateSelectedBlockSettings({ style: value })}
              options={[
                { value: 'solid', label: t('Solid') },
                { value: 'dashed', label: t('Dashed') },
                { value: 'dotted', label: t('Dotted') },
              ]}
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'spacer' && (
          <FieldBlock>
            <FieldLabel>{t('Height')}</FieldLabel>
            <InputNumber
              disabled={isPublishedPage}
              style={{ width: '100%' }}
              min={8}
              value={Number(selectedBlock.settings?.height) || 48}
              onChange={value =>
                updateSelectedBlockSettings({ height: Number(value) || 48 })
              }
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'html' && (
          <FieldBlock>
            <FieldLabel>{t('HTML')}</FieldLabel>
            <Input.TextArea
              disabled={isPublishedPage}
              rows={8}
              value={selectedBlock.content?.html || ''}
              onChange={event =>
                updateSelectedBlockContent({ html: event.target.value })
              }
            />
          </FieldBlock>
        )}
        <Space wrap>
          <Button
            disabled={isPublishedPage}
            onClick={() => resizeSelectedBlock('gridSpan', -1)}
          >
            ← {t('Narrower')}
          </Button>
          <Button
            disabled={isPublishedPage}
            onClick={() => resizeSelectedBlock('gridSpan', 1)}
          >
            → {t('Wider')}
          </Button>
          <Button
            disabled={isPublishedPage}
            onClick={() => resizeSelectedBlock('minHeight', -1)}
          >
            ↓ {t('Shorter')}
          </Button>
          <Button
            disabled={isPublishedPage}
            onClick={() => resizeSelectedBlock('minHeight', 1)}
          >
            ↑ {t('Taller')}
          </Button>
          <Button
            disabled={isPublishedPage}
            onClick={() => moveSelectedBlock(-1)}
          >
            ↑ {t('Move')}
          </Button>
          <Button
            disabled={isPublishedPage}
            onClick={() => moveSelectedBlock(1)}
          >
            ↓ {t('Move')}
          </Button>
          <Button disabled={isPublishedPage} onClick={duplicateSelectedBlock}>
            {t('Duplicate')}
          </Button>
          {isContainerBlock(selectedBlock.block_type) ? (
            <Button
              disabled={isPublishedPage}
              onClick={() => addBlock(quickInsertType)}
            >
              {t('Add Child')}
            </Button>
          ) : null}
          <Button
            danger
            disabled={isPublishedPage}
            onClick={removeSelectedBlock}
          >
            {t('Delete')}
          </Button>
        </Space>
      </SectionList>
    );
  }

  function handleSelectBlock(block: PortalPageBlock) {
    setSelection({ type: 'block', uid: blockKey(block) });
    setSettingsOpen(true);
  }

  function renderSlotRegion(
    slot: (typeof SLOT_OPTIONS)[number],
    showSlotChrome: boolean,
  ) {
    const slotBlocks = slotGroups[slot.value] || [];
    if (!showSlotChrome && !slotBlocks.length) {
      return null;
    }
    return (
      <RegionCard key={slot.value}>
        {showSlotChrome ? (
          <RegionHeader>
            <RegionTitle>
              <SlotLabel>
                {blockIcon(slot.value, 'layout')}
                <span>{slot.label}</span>
              </SlotLabel>
            </RegionTitle>
            <InlinePills>
              <Tag>{t('%s blocks', slotBlocks.length)}</Tag>
              <Button
                size="small"
                icon={<PlusOutlined />}
                disabled={isPublishedPage || selection.type === 'block'}
                onClick={() => {
                  setQuickInsertSlot(slot.value);
                  addBlock(quickInsertType);
                }}
              >
                {t('Add Here')}
              </Button>
            </InlinePills>
          </RegionHeader>
        ) : null}
        {slotBlocks.length ? (
          <RenderBlockTree
            blocks={slotBlocks}
            charts={charts}
            dashboards={dashboards}
            mediaAssets={mediaAssets}
            page={draftPage}
            navigation={navigationMenus}
            mode={showSlotChrome ? 'editor' : 'public'}
            selectedBlockUid={
              showSlotChrome && selection.type === 'block'
                ? selection.uid
                : undefined
            }
            onSelectBlock={showSlotChrome ? handleSelectBlock : undefined}
            onInlineRichTextChange={
              showSlotChrome ? updateRichTextBlock : undefined
            }
          />
        ) : showSlotChrome ? (
          <Empty
            description={t(
              'No blocks in this region yet. Use Add Here to place content.',
            )}
          />
        ) : null}
      </RegionCard>
    );
  }

  function renderDocumentDrawer() {
    return (
      <DrawerStack>
        <DrawerSection>
          <PanelHeader>
            <PanelTitle>{t('Pages')}</PanelTitle>
            <Button size="small" icon={<PlusOutlined />} onClick={onNewPage}>
              {t('New')}
            </Button>
          </PanelHeader>
          <FieldBlock>
            <FieldLabel>{t('Find Page')}</FieldLabel>
            <Input
              value={search}
              onChange={event => onSearchChange(event.target.value)}
              placeholder={t('Search by title or slug')}
            />
          </FieldBlock>
          <SectionList style={{ marginTop: 16 }}>
            {filteredPages.map(page => (
              <CardButton
                key={page.id}
                $active={page.slug === draftPage?.slug}
                onClick={() => {
                  onSelectPage(page.slug || null);
                  setDocumentOpen(false);
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <strong>{page.title}</strong>
                  <Tag color={page.visibility === 'public' ? 'green' : 'blue'}>
                    {page.visibility || 'draft'}
                  </Tag>
                </div>
                <TinyMeta>{page.path || page.slug}</TinyMeta>
              </CardButton>
            ))}
          </SectionList>
        </DrawerSection>
        {draftPage ? (
          <DrawerSection>
            <PanelHeader>
              <PanelTitle>{t('Block Outline')}</PanelTitle>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setSelection({ type: 'page' });
                  setSettingsOpen(true);
                }}
              >
                {t('Page')}
              </Button>
            </PanelHeader>
            <SectionList>
              {flattenedBlocks.length ? (
                flattenedBlocks.map(({ block, depth }) => (
                  <CardButton
                    key={blockKey(block)}
                    $depth={depth}
                    $active={
                      selection.type === 'block' &&
                      selection.uid === blockKey(block)
                    }
                    onClick={() => {
                      setSelection({ type: 'block', uid: blockKey(block) });
                      setSettingsOpen(true);
                      setDocumentOpen(false);
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <strong>
                        <InlinePills>
                          {blockIcon(
                            block.block_type,
                            insertableBlockTypes.find(
                              definition =>
                                definition.type === block.block_type,
                            )?.icon,
                          )}
                          <span>
                            {block.content?.title ||
                              block.content?.text ||
                              block.metadata?.label ||
                              t('Block')}
                          </span>
                        </InlinePills>
                      </strong>
                      <Tag>{block.block_type}</Tag>
                    </div>
                    <TinyMeta>{block.slot || 'content'}</TinyMeta>
                  </CardButton>
                ))
              ) : (
                <Empty
                  description={t('Add a block to start composing this page.')}
                />
              )}
            </SectionList>
          </DrawerSection>
        ) : null}
      </DrawerStack>
    );
  }

  return (
    <StudioLayout>
      <StudioBar>
        <StudioBarGroup>
          <Button
            icon={documentOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
            onClick={() => setDocumentOpen(true)}
          >
            {t('Document')}
          </Button>
          <Button
            icon={<SettingOutlined />}
            onClick={() => {
              setSelection({ type: 'page' });
              setSettingsOpen(true);
            }}
          >
            {t('Page Settings')}
          </Button>
          {selection.type === 'block' && selectedBlock ? (
            <Tag color="processing">
              {selectedBlock.metadata?.label || selectedBlock.block_type}
            </Tag>
          ) : draftPage ? (
            <Tag color={draftPage.is_published ? 'green' : 'default'}>
              {draftPage.status || t('draft')}
            </Tag>
          ) : null}
        </StudioBarGroup>
        <StudioBarGroup>
          <StudioModeChip
            type="button"
            $active={canvasMode === 'compose'}
            onClick={() => setCanvasMode('compose')}
          >
            <EditOutlined /> {t('Compose')}
          </StudioModeChip>
          <StudioModeChip
            type="button"
            $active={canvasMode === 'preview'}
            onClick={() => setCanvasMode('preview')}
          >
            <EyeOutlined /> {t('Preview')}
          </StudioModeChip>
          {PREVIEW_VIEWPORTS.map(viewport => (
            <Button
              key={viewport.value}
              size="small"
              type={previewViewport === viewport.value ? 'primary' : 'default'}
              icon={viewportIcon(viewport.value)}
              onClick={() => setPreviewViewport(viewport.value)}
            >
              {viewport.label}
            </Button>
          ))}
          <Select
            disabled={isPublishedPage}
            size="small"
            style={{ minWidth: 180 }}
            value={quickInsertType}
            onChange={value => setQuickInsertType(value)}
            options={insertableBlockTypes.map(definition => ({
              value: definition.type,
              label: `${definition.label} · ${definition.category}`,
            }))}
          />
          <Select
            disabled={isPublishedPage || selection.type === 'block'}
            size="small"
            style={{ minWidth: 150 }}
            value={quickInsertSlot}
            onChange={value => setQuickInsertSlot(value)}
            options={SLOT_OPTIONS.map(option => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <Button
            disabled={isPublishedPage}
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => addBlock(quickInsertType)}
          >
            {quickInsertLabel}
          </Button>
          <Button
            onClick={() => setSettingsOpen(true)}
            icon={<SettingOutlined />}
          >
            {t('Settings')}
          </Button>
        </StudioBarGroup>
      </StudioBar>
      <Panel>
        <PanelHeader>
          <div>
            <PanelTitle>{t('Page Studio')}</PanelTitle>
            <TinyMeta>
              {draftPage
                ? canvasMode === 'preview'
                  ? t('Full-page preview of the current draft.')
                  : t(
                      'Compose blocks in-page and open Settings for block details.',
                    )
                : t('Choose a page or create a new one.')}
            </TinyMeta>
          </div>
          {draftPage ? (
            <InlinePills>
              <Tag>
                {draftPage.path || draftPage.slug || t('untitled-page')}
              </Tag>
              {selection.type === 'block' ? (
                <Tag color="processing">{t('Block selected')}</Tag>
              ) : (
                <Tag>{t('Page settings')}</Tag>
              )}
            </InlinePills>
          ) : null}
        </PanelHeader>
        {draftPage ? (
          <>
            {isPublishedPage ? (
              <Alert
                showIcon
                type="info"
                style={{ marginBottom: 16 }}
                message={t(
                  'Published pages are read-only. Unpublish to edit content.',
                )}
              />
            ) : null}
            <TinyMeta style={{ marginBottom: 12 }}>
              {selection.type === 'block'
                ? selectedBlock && isContainerBlock(selectedBlock.block_type)
                  ? t(
                      'The selected container can receive child blocks. Click any block in the canvas to edit it.',
                    )
                  : t(
                      'Click any block in the canvas to edit it. New blocks insert after the current selection.',
                    )
                : t(
                    'Use Document to switch pages or choose blocks, and Settings to format the selected content.',
                  )}
            </TinyMeta>
            <CanvasSurface>
              <ViewportFrame $mode={previewViewport}>
                <StudioViewport>
                  <RegionGrid>
                    {SLOT_OPTIONS.map(slot =>
                      renderSlotRegion(slot, canvasMode === 'compose'),
                    )}
                  </RegionGrid>
                </StudioViewport>
              </ViewportFrame>
            </CanvasSurface>
          </>
        ) : (
          <Empty description={t('Choose a page or create a new one.')} />
        )}
      </Panel>
      <Drawer
        placement="left"
        width={380}
        title={t('Document')}
        open={documentOpen}
        getContainer={false}
        mask={false}
        onClose={() => setDocumentOpen(false)}
      >
        {renderDocumentDrawer()}
      </Drawer>
      <Drawer
        placement="right"
        width={420}
        title={
          selection.type === 'page'
            ? t('Page Settings')
            : selectedBlock?.metadata?.label || t('Block Settings')
        }
        open={settingsOpen}
        getContainer={false}
        mask={false}
        onClose={() => setSettingsOpen(false)}
      >
        {renderInspector()}
      </Drawer>
    </StudioLayout>
  );
}
