import { QUERY_MODE_REQUISITES } from 'src/explore/constants';

export const getSavedSliceHiddenFields = (
  hiddenFormData: Record<string, unknown> | undefined,
  slice: { form_data?: Record<string, unknown> } | undefined,
) =>
  Object.keys(hiddenFormData ?? {}).filter(
    key => slice?.form_data?.[key] !== undefined,
  );

export const getHiddenFieldsToOmit = ({
  hiddenFormData,
  slice,
  hasQueryMode,
}: {
  hiddenFormData?: Record<string, unknown>;
  slice?: { form_data?: Record<string, unknown> };
  hasQueryMode: boolean;
}) => {
  const savedSliceHiddenFields = new Set(
    getSavedSliceHiddenFields(hiddenFormData, slice),
  );

  return Object.keys(hiddenFormData ?? {}).filter(key => {
    if (savedSliceHiddenFields.has(key)) {
      return false;
    }
    return hasQueryMode ? !QUERY_MODE_REQUISITES.has(key) : true;
  });
};
