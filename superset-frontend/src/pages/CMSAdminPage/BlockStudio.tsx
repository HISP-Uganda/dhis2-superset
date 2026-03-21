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
/* eslint-disable no-restricted-imports, theme-colors/no-literal-colors */

import { useMemo, useState } from 'react';
import { MarkdownEditor } from '@superset-ui/core/components';
import { styled, t } from '@superset-ui/core';
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
} from 'antd';
import { RenderBlockTree } from 'src/pages/PublicLandingPage/BlockRenderer';
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
} from 'src/pages/PublicLandingPage/types';

const StudioLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(0, 1.35fr) minmax(
      320px,
      1fr
    );
  gap: 16px;

  @media (max-width: 1280px) {
    grid-template-columns: 1fr;
  }
`;

const Panel = styled.div`
  padding: 18px;
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.05);
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
  blockTypes?: PortalBlockDefinition[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelectPage: (pageSlug: string | null) => void;
  onNewPage: () => void;
  onChangeDraftPage: (nextPage: PortalPage) => void;
};

type Selection = { type: 'page' } | { type: 'block'; uid: string };

function blockKey(block: PortalPageBlock) {
  return block.uid || String(block.id);
}

export default function BlockStudio({
  draftPage,
  pages,
  charts,
  dashboards,
  mediaAssets,
  navigationMenus = { header: [], footer: [] },
  styleBundles,
  blockTypes = [],
  search,
  onSearchChange,
  onSelectPage,
  onNewPage,
  onChangeDraftPage,
}: BlockStudioProps) {
  const [selection, setSelection] = useState<Selection>({ type: 'page' });
  const blocks = useMemo(() => ensurePageBlocks(draftPage), [draftPage]);
  const flattenedBlocks = useMemo(() => flattenBlocks(blocks), [blocks]);
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
    : [
        {
          type: 'section',
          label: t('Section'),
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
          type: 'heading',
          label: t('Heading'),
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
          type: 'hero',
          label: t('Hero'),
          category: 'layout',
          is_container: true,
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
          type: 'dynamic_widget',
          label: t('Dynamic Widget'),
          category: 'data',
          is_container: false,
        },
        {
          type: 'breadcrumb',
          label: t('Breadcrumb'),
          category: 'utility',
          is_container: false,
        },
        {
          type: 'page_title',
          label: t('Page Title'),
          category: 'utility',
          is_container: false,
        },
        {
          type: 'menu',
          label: t('Menu'),
          category: 'utility',
          is_container: false,
        },
      ];

  function pushBlocks(nextBlocks: PortalPageBlock[]) {
    if (!draftPage) {
      return;
    }
    onChangeDraftPage({
      ...draftPage,
      blocks: nextBlocks,
    });
  }

  function updatePage(patch: Partial<PortalPage>) {
    if (!draftPage) {
      return;
    }
    onChangeDraftPage({
      ...draftPage,
      ...patch,
      blocks,
    });
  }

  function addBlock(blockType: string) {
    const targetUid = selection.type === 'block' ? selection.uid : null;
    const nextBlocks = targetUid
      ? insertBlockRelative(
          blocks,
          targetUid,
          blockType,
          selectedBlock && isContainerBlock(selectedBlock.block_type)
            ? 'child'
            : 'after',
        )
      : addRootBlock(blocks, blockType);
    pushBlocks(nextBlocks);
  }

  function updateSelectedBlock(patch: Partial<PortalPageBlock>) {
    if (!selectedBlock) {
      return;
    }
    pushBlocks(updateBlockByUid(blocks, blockKey(selectedBlock), patch));
  }

  function updateSelectedBlockContent(patch: Record<string, any>) {
    if (!selectedBlock) {
      return;
    }
    pushBlocks(updateBlockContent(blocks, blockKey(selectedBlock), patch));
  }

  function updateSelectedBlockSettings(patch: Record<string, any>) {
    if (!selectedBlock) {
      return;
    }
    pushBlocks(updateBlockSettings(blocks, blockKey(selectedBlock), patch));
  }

  function removeSelectedBlock() {
    if (!selectedBlock) {
      return;
    }
    pushBlocks(removeBlockByUid(blocks, blockKey(selectedBlock)));
    setSelection({ type: 'page' });
  }

  function duplicateSelectedBlock() {
    if (!selectedBlock) {
      return;
    }
    pushBlocks(duplicateBlockByUid(blocks, blockKey(selectedBlock)));
  }

  function moveSelectedBlock(direction: -1 | 1) {
    if (!selectedBlock) {
      return;
    }
    pushBlocks(moveBlockByUid(blocks, blockKey(selectedBlock), direction));
  }

  function renderInspector() {
    if (!draftPage) {
      return <Empty description={t('Choose a page or create a new one.')} />;
    }
    if (!selectedBlock) {
      return (
        <SectionList>
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Title')}</FieldLabel>
              <Input
                value={draftPage.title}
                onChange={event => updatePage({ title: event.target.value })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Slug')}</FieldLabel>
              <Input
                value={draftPage.slug || ''}
                onChange={event => updatePage({ slug: event.target.value })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Navigation Label')}</FieldLabel>
              <Input
                value={draftPage.navigation_label || ''}
                onChange={event =>
                  updatePage({ navigation_label: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Parent Page')}</FieldLabel>
              <Select
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
              <FieldLabel>{t('Subtitle')}</FieldLabel>
              <Input
                value={draftPage.subtitle || ''}
                onChange={event => updatePage({ subtitle: event.target.value })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Visibility')}</FieldLabel>
              <Select
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
              <FieldLabel>{t('Published')}</FieldLabel>
              <Switch
                checked={draftPage.is_published}
                onChange={checked => updatePage({ is_published: checked })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Homepage')}</FieldLabel>
              <Switch
                checked={draftPage.is_homepage}
                onChange={checked => updatePage({ is_homepage: checked })}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Featured Image')}</FieldLabel>
              <Select
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
            <FieldLabel>{t('Description')}</FieldLabel>
            <MarkdownEditor
              width="100%"
              height="180px"
              showGutter={false}
              editorProps={{ $blockScrolling: true }}
              value={draftPage.description || ''}
              onChange={(value: string) => updatePage({ description: value })}
            />
          </FieldBlock>
          <TinyMeta>
            {t('Public path')}: /superset/public/
            {draftPage.path || draftPage.slug || t('page-slug')}/
          </TinyMeta>
        </SectionList>
      );
    }

    return (
      <SectionList>
        <FieldGrid>
          <FieldBlock>
            <FieldLabel>{t('Block Type')}</FieldLabel>
            <Select
              value={selectedBlock.block_type}
              options={insertableBlockTypes.map(definition => ({
                value: definition.type,
                label: definition.label,
              }))}
              onChange={value =>
                updateSelectedBlock({
                  ...createEmptyBlock(value),
                  id: selectedBlock.id,
                  uid: selectedBlock.uid,
                })
              }
            />
          </FieldBlock>
          <FieldBlock>
            <FieldLabel>{t('Slot')}</FieldLabel>
            <Select
              value={selectedBlock.slot || 'content'}
              onChange={value => updateSelectedBlock({ slot: value })}
              options={[
                { value: 'header', label: t('Header') },
                { value: 'hero', label: t('Hero') },
                { value: 'content', label: t('Content') },
                { value: 'sidebar', label: t('Sidebar') },
                { value: 'cta', label: t('CTA') },
                { value: 'footer', label: t('Footer') },
              ]}
            />
          </FieldBlock>
        </FieldGrid>
        <FieldGrid>
          <FieldBlock>
            <FieldLabel>{t('Status')}</FieldLabel>
            <Select
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
        {(selectedBlock.block_type === 'rich_text' ||
          selectedBlock.block_type === 'paragraph' ||
          selectedBlock.block_type === 'card' ||
          selectedBlock.block_type === 'group' ||
          selectedBlock.block_type === 'section' ||
          selectedBlock.block_type === 'callout') && (
          <FieldBlock>
            <FieldLabel>{t('Body')}</FieldLabel>
            <MarkdownEditor
              width="100%"
              height={
                selectedBlock.block_type === 'rich_text' ? '220px' : '180px'
              }
              showGutter={false}
              editorProps={{ $blockScrolling: true }}
              value={selectedBlock.content?.body || ''}
              onChange={(value: string) =>
                updateSelectedBlockContent({ body: value })
              }
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
                value={selectedBlock.content?.text || ''}
                onChange={event =>
                  updateSelectedBlockContent({ text: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Level')}</FieldLabel>
              <InputNumber
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
              rows={3}
              value={selectedBlock.content?.subtitle || ''}
              onChange={event =>
                updateSelectedBlockContent({ subtitle: event.target.value })
              }
            />
          </FieldBlock>
        )}
        {selectedBlock.block_type === 'image' && (
          <SectionList>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Image Asset')}</FieldLabel>
                <Select
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
                  value={selectedBlock.content?.url || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ url: event.target.value })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Alt Text')}</FieldLabel>
                <Input
                  value={selectedBlock.content?.alt || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ alt: event.target.value })
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Caption')}</FieldLabel>
                <Input
                  value={selectedBlock.content?.caption || ''}
                  onChange={event =>
                    updateSelectedBlockContent({ caption: event.target.value })
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
              <MarkdownEditor
                width="100%"
                height="160px"
                showGutter={false}
                editorProps={{ $blockScrolling: true }}
                value={selectedBlock.content?.body || ''}
                onChange={(value: string) =>
                  updateSelectedBlockContent({ body: value })
                }
              />
            </FieldBlock>
          </SectionList>
        )}
        {selectedBlock.block_type === 'button' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Label')}</FieldLabel>
              <Input
                value={selectedBlock.content?.label || ''}
                onChange={event =>
                  updateSelectedBlockContent({ label: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('URL')}</FieldLabel>
              <Input
                value={selectedBlock.settings?.url || ''}
                onChange={event =>
                  updateSelectedBlockSettings({ url: event.target.value })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        {selectedBlock.block_type === 'chart' && (
          <>
            <FieldBlock>
              <FieldLabel>{t('Chart')}</FieldLabel>
              <Select
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
                value={selectedBlock.settings?.anchor || ''}
                onChange={event =>
                  updateSelectedBlockSettings({ anchor: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Background')}</FieldLabel>
              <Input
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
        {selectedBlock.block_type === 'dynamic_widget' && (
          <FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Widget Type')}</FieldLabel>
              <Select
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
                checked={selectedBlock.settings?.showSubtitle !== false}
                onChange={checked =>
                  updateSelectedBlockSettings({ showSubtitle: checked })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Show Excerpt')}</FieldLabel>
              <Switch
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
                value={selectedBlock.content?.value || ''}
                onChange={event =>
                  updateSelectedBlockContent({ value: event.target.value })
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Caption')}</FieldLabel>
              <Input
                value={selectedBlock.content?.caption || ''}
                onChange={event =>
                  updateSelectedBlockContent({ caption: event.target.value })
                }
              />
            </FieldBlock>
          </FieldGrid>
        )}
        <Space wrap>
          <Button onClick={() => moveSelectedBlock(-1)}>↑ {t('Move')}</Button>
          <Button onClick={() => moveSelectedBlock(1)}>↓ {t('Move')}</Button>
          <Button onClick={duplicateSelectedBlock}>{t('Duplicate')}</Button>
          {isContainerBlock(selectedBlock.block_type) ? (
            <Button onClick={() => addBlock('paragraph')}>
              {t('Add Child')}
            </Button>
          ) : null}
          <Button danger onClick={removeSelectedBlock}>
            {t('Delete')}
          </Button>
        </Space>
      </SectionList>
    );
  }

  return (
    <StudioLayout>
      <Panel>
        <PanelHeader>
          <PanelTitle>{t('Pages & Outline')}</PanelTitle>
          <Button size="small" onClick={onNewPage}>
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
              onClick={() => onSelectPage(page.slug || null)}
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
        {draftPage ? (
          <>
            <PanelHeader style={{ marginTop: 18 }}>
              <PanelTitle>{t('Inserter')}</PanelTitle>
            </PanelHeader>
            <Select
              style={{ width: '100%' }}
              placeholder={t('Add a block')}
              onChange={value => addBlock(value)}
              options={insertableBlockTypes.map(definition => ({
                value: definition.type,
                label: `${definition.label} · ${definition.category}`,
              }))}
            />
            <PanelHeader style={{ marginTop: 18 }}>
              <PanelTitle>{t('Block Outline')}</PanelTitle>
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
                    onClick={() =>
                      setSelection({ type: 'block', uid: blockKey(block) })
                    }
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <strong>
                        {block.content?.title ||
                          block.content?.text ||
                          block.metadata?.label ||
                          t('Block')}
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
          </>
        ) : null}
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>{t('Canvas Preview')}</PanelTitle>
          {draftPage ? (
            <Tag color={draftPage.is_published ? 'green' : 'default'}>
              {draftPage.status || t('draft')}
            </Tag>
          ) : null}
        </PanelHeader>
        {draftPage ? (
          <RenderBlockTree
            blocks={blocks}
            charts={charts}
            dashboards={dashboards}
            page={draftPage}
            navigation={navigationMenus}
            mode="editor"
          />
        ) : (
          <Empty description={t('Choose a page or create a new one.')} />
        )}
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>
            {selection.type === 'page'
              ? t('Page Settings')
              : selectedBlock?.metadata?.label || t('Block Settings')}
          </PanelTitle>
        </PanelHeader>
        {renderInspector()}
      </Panel>
    </StudioLayout>
  );
}
