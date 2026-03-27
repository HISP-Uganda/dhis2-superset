import {
  getHiddenFieldsToOmit,
  getSavedSliceHiddenFields,
} from './hiddenFields';

describe('ExploreViewContainer hidden field retention', () => {
  test('retains hidden fields that are explicitly saved on the slice', () => {
    const hiddenFormData = {
      time_grain_sqla: 'P1D',
      x_axis_sort_asc: true,
      optional_key1: 'value1',
    };
    const slice = {
      form_data: {
        time_grain_sqla: 'P1D',
        x_axis_sort_asc: true,
      },
    };

    expect(getSavedSliceHiddenFields(hiddenFormData, slice as any)).toEqual([
      'time_grain_sqla',
      'x_axis_sort_asc',
    ]);
    expect(
      getHiddenFieldsToOmit({
        hiddenFormData,
        slice: slice as any,
        hasQueryMode: false,
      }),
    ).toEqual(['optional_key1']);
  });

  test('retains query mode requisites and saved hidden controls together', () => {
    const hiddenFormData = {
      all_columns: ['all_columns'],
      groupby: ['groupby'],
      time_grain_sqla: 'P1D',
      optional_key1: 'value1',
    };
    const slice = {
      form_data: {
        time_grain_sqla: 'P1D',
      },
    };

    expect(
      getHiddenFieldsToOmit({
        hiddenFormData,
        slice: slice as any,
        hasQueryMode: true,
      }),
    ).toEqual(['optional_key1']);
  });
});
