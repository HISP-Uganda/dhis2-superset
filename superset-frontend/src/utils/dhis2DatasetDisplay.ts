export type Dhis2DatasetLike = {
  table_name?: string | null;
  extra?: string | Record<string, any> | null;
};

export const parseDatasetExtra = (
  extra: Dhis2DatasetLike['extra'],
): Record<string, any> => {
  if (!extra) {
    return {};
  }
  if (typeof extra === 'string') {
    try {
      return JSON.parse(extra) || {};
    } catch {
      return {};
    }
  }
  return extra;
};

export const humanizeDhIS2DatasetTitle = (title: string) => {
  const isMart = /_mart$/i.test(title);
  const baseTitle = title
    .replace(/^sv_\d+_/i, '')
    .replace(/_mart$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
  return isMart ? `${baseTitle} [MART]` : baseTitle;
};

export const getDatasetDisplayName = (dataset: Dhis2DatasetLike): string => {
  const parsedExtra = parseDatasetExtra(dataset.extra);
  const savedDisplayName = parsedExtra?.dhis2_dataset_display_name;
  if (typeof savedDisplayName === 'string' && savedDisplayName.trim()) {
    return savedDisplayName.trim();
  }

  const tableName = `${dataset.table_name || ''}`.trim();
  if (/^sv_\d+_.+(_mart)?$/i.test(tableName)) {
    return humanizeDhIS2DatasetTitle(tableName);
  }
  return tableName;
};
