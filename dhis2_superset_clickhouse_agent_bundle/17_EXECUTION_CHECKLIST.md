# Execution Checklist

## Pre-implementation
- [ ] Inspect repository structure.
- [ ] Confirm current staging and serving paths.
- [ ] Confirm current Superset dataset dependencies.
- [ ] Confirm active engine configuration path.

## Schema and data path
- [ ] Define raw landing tables.
- [ ] Define normalized staging tables.
- [ ] Define serving marts.
- [ ] Define map-serving marts.
- [ ] Define public dashboard marts where needed.

## Refactor
- [ ] Remove Python serving materialization from hot path.
- [ ] Refactor sync orchestration to native ClickHouse refresh.
- [ ] Remove repeated full serving rebuild behavior.
- [ ] Reduce or eliminate delete mutation hot paths.
- [ ] Remove duplicate metadata-side large-row persistence from hot path.

## Superset and runtime
- [ ] Repoint datasets to serving marts.
- [ ] Validate cache configuration.
- [ ] Validate Celery usage.
- [ ] Validate active ClickHouse engine enforcement.

## Safety and quality
- [ ] Add correctness validation.
- [ ] Add observability.
- [ ] Add tests.
- [ ] Add migration guide.
- [ ] Add rollback guide.
- [ ] Add architecture documentation.
