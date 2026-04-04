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
import { FC, useCallback, useState } from 'react';
import cx from 'classnames';
import { css, styled, t, JsonObject, sanitizeHtml } from '@superset-ui/core';
import { SafeMarkdown } from '@superset-ui/core/components';
import { Empty, Input } from 'antd';
import type { ConnectDragSource } from 'react-dnd';
import { Draggable } from '../../dnd/DragDroppable';
import { COLUMN_TYPE, ROW_TYPE } from '../../../util/componentTypes';
import WithPopoverMenu from '../../menu/WithPopoverMenu';
import ResizableContainer from '../../resizable/ResizableContainer';
import {
  GRID_BASE_UNIT,
  GRID_MIN_COLUMN_COUNT,
} from '../../../util/constants';
import HoverMenu from '../../menu/HoverMenu';
import DeleteComponentButton from '../../DeleteComponentButton';

const { TextArea } = Input;

interface BlockProps {
  component: JsonObject;
  parentComponent: JsonObject;
  index: number;
  depth: number;
  handleComponentDrop: (dropResult: unknown) => void;
  editMode: boolean;
  columnWidth: number;
  availableColumnCount: number;
  onResizeStart: () => void;
  onResizeStop: (...args: any[]) => void;
  onResize: (...args: any[]) => void;
  deleteComponent: (id: string, parentId: string) => void;
  updateComponents: (updates: Record<string, JsonObject>) => void;
  parentId: string;
  id: string;
}

const BlockContainer = styled.div`
  ${({ theme }) => css`
    padding: ${theme.sizeUnit * 3}px;
    width: 100%;
    height: 100%;
    overflow: auto;

    .block-title {
      font-size: ${theme.fontSizeLG}px;
      font-weight: ${theme.fontWeightBold};
      margin-bottom: ${theme.sizeUnit * 2}px;
    }

    .block-body {
      font-size: ${theme.fontSize}px;
      line-height: 1.6;
      color: ${theme.colorText};
    }

    .block-callout {
      padding: ${theme.sizeUnit * 3}px;
      border-left: 4px solid ${theme.colorPrimary};
      background: ${theme.colorPrimaryBg};
      border-radius: 0 ${theme.borderRadius}px ${theme.borderRadius}px 0;
    }

    .block-callout--warning {
      border-left-color: ${theme.colorWarning};
      background: ${theme.colorWarningBg};
    }

    .block-callout--error {
      border-left-color: ${theme.colorError};
      background: ${theme.colorErrorBg};
    }

    .block-callout--success {
      border-left-color: ${theme.colorSuccess};
      background: ${theme.colorSuccessBg};
    }

    .block-statistic {
      text-align: center;
      padding: ${theme.sizeUnit * 4}px;
    }

    .block-statistic-value {
      font-size: 36px;
      font-weight: ${theme.fontWeightBold};
      color: ${theme.colorPrimary};
      line-height: 1.2;
    }

    .block-statistic-label {
      font-size: ${theme.fontSize}px;
      color: ${theme.colorTextSecondary};
      margin-top: ${theme.sizeUnit}px;
    }

    .block-quote {
      padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
      border-left: 3px solid ${theme.colorBorderSecondary};
      font-style: italic;
      color: ${theme.colorTextSecondary};
    }

    .block-quote footer {
      margin-top: ${theme.sizeUnit * 2}px;
      font-style: normal;
      font-size: ${theme.fontSizeSM}px;
    }

    .block-image img {
      max-width: 100%;
      border-radius: ${theme.borderRadius}px;
    }

    .block-type-badge {
      display: inline-block;
      font-size: ${theme.fontSizeXS}px;
      color: ${theme.colorTextTertiary};
      background: ${theme.colorFillAlter};
      padding: 2px 8px;
      border-radius: ${theme.borderRadius}px;
      margin-bottom: ${theme.sizeUnit}px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
  `}
`;

const BLOCK_TYPE_LABELS: Record<string, string> = {
  rich_text: 'Rich Text',
  heading: 'Heading',
  paragraph: 'Paragraph',
  callout: 'Callout',
  statistic: 'Statistic',
  quote: 'Quote',
  image: 'Image',
  embed: 'Embed',
  html: 'HTML',
  divider: 'Divider',
  spacer: 'Spacer',
  hero: 'Hero',
  card: 'Card',
  table: 'Table',
};

const Block: FC<BlockProps> = ({
  component,
  parentComponent,
  index,
  depth,
  handleComponentDrop,
  editMode,
  columnWidth,
  availableColumnCount,
  onResizeStart,
  onResizeStop,
  onResize,
  deleteComponent,
  updateComponents,
  parentId,
  id,
}) => {
  const meta = component.meta || {};
  const blockType = meta.blockType || 'rich_text';
  const content = meta.content || {};
  const [isEditing, setIsEditing] = useState(false);

  const widthMultiple =
    parentComponent.type === COLUMN_TYPE
      ? parentComponent.meta.width || GRID_MIN_COLUMN_COUNT
      : component.meta.width || GRID_MIN_COLUMN_COUNT;

  const handleDeleteComponent = useCallback(() => {
    deleteComponent(id, parentId);
  }, [deleteComponent, id, parentId]);

  const updateContent = useCallback(
    (key: string, value: string) => {
      updateComponents({
        [component.id]: {
          ...component,
          meta: {
            ...component.meta,
            content: {
              ...(component.meta.content || {}),
              [key]: value,
            },
          },
        },
      });
    },
    [updateComponents, component],
  );

  const renderBlockContent = () => {
    switch (blockType) {
      case 'heading':
        return editMode && isEditing ? (
          <Input
            defaultValue={content.text || t('Heading')}
            onBlur={e => {
              updateContent('text', e.target.value);
              setIsEditing(false);
            }}
            onPressEnter={e => {
              updateContent('text', (e.target as HTMLInputElement).value);
              setIsEditing(false);
            }}
            autoFocus
            size="large"
          />
        ) : (
          <div className="block-title" onDoubleClick={() => setIsEditing(true)}>
            {content.text || t('Heading')}
          </div>
        );

      case 'paragraph':
      case 'rich_text':
        return editMode && isEditing ? (
          <TextArea
            defaultValue={content.body || ''}
            placeholder={t('Enter text content...')}
            onBlur={e => {
              updateContent('body', e.target.value);
              setIsEditing(false);
            }}
            autoFocus
            autoSize={{ minRows: 3, maxRows: 20 }}
          />
        ) : (
          <div
            className="block-body"
            onDoubleClick={() => setIsEditing(true)}
          >
            {content.body ? (
              <SafeMarkdown source={content.body} />
            ) : (
              <Empty
                description={
                  editMode
                    ? t('Double-click to edit text content')
                    : t('No content')
                }
              />
            )}
          </div>
        );

      case 'callout': {
        const tone = meta.settings?.tone || 'info';
        const toneClass =
          tone === 'warning'
            ? 'block-callout--warning'
            : tone === 'error'
              ? 'block-callout--error'
              : tone === 'success'
                ? 'block-callout--success'
                : '';
        return (
          <div className={cx('block-callout', toneClass)}>
            {content.title && <div className="block-title">{content.title}</div>}
            <div className="block-body">
              {editMode && isEditing ? (
                <TextArea
                  defaultValue={content.body || ''}
                  placeholder={t('Callout content...')}
                  onBlur={e => {
                    updateContent('body', e.target.value);
                    setIsEditing(false);
                  }}
                  autoFocus
                  autoSize={{ minRows: 2, maxRows: 10 }}
                />
              ) : (
                <span onDoubleClick={() => setIsEditing(true)}>
                  {content.body || t('Callout content goes here.')}
                </span>
              )}
            </div>
          </div>
        );
      }

      case 'statistic':
        return (
          <div className="block-statistic">
            <div className="block-statistic-value">
              {editMode && isEditing ? (
                <Input
                  defaultValue={content.value || '0'}
                  onBlur={e => {
                    updateContent('value', e.target.value);
                    setIsEditing(false);
                  }}
                  autoFocus
                  style={{ textAlign: 'center', fontSize: 36 }}
                />
              ) : (
                <span onDoubleClick={() => setIsEditing(true)}>
                  {content.value || '0'}
                </span>
              )}
            </div>
            <div className="block-statistic-label">
              {content.title || t('Statistic')}
            </div>
          </div>
        );

      case 'quote':
        return (
          <div className="block-quote">
            {editMode && isEditing ? (
              <TextArea
                defaultValue={content.quote || ''}
                placeholder={t('Quote text...')}
                onBlur={e => {
                  updateContent('quote', e.target.value);
                  setIsEditing(false);
                }}
                autoFocus
                autoSize={{ minRows: 2, maxRows: 10 }}
              />
            ) : (
              <span onDoubleClick={() => setIsEditing(true)}>
                {content.quote || t('Quote text goes here.')}
              </span>
            )}
            {content.citation && <footer>{content.citation}</footer>}
          </div>
        );

      case 'image':
        return (
          <div className="block-image">
            {content.url ? (
              <img src={content.url} alt={content.alt || t('Image')} />
            ) : (
              <Empty description={t('No image configured.')} />
            )}
            {content.caption && (
              <div className="block-body" style={{ marginTop: 8 }}>
                {content.caption}
              </div>
            )}
          </div>
        );

      case 'embed':
      case 'video':
        return content.url ? (
          <iframe
            src={content.url}
            title={content.title || blockType}
            style={{ width: '100%', height: '100%', border: 0, minHeight: 200 }}
          />
        ) : (
          <Empty description={t('No embed URL configured.')} />
        );

      case 'html':
        return content.html ? (
          <div
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(content.html),
            }}
          />
        ) : (
          <Empty description={t('No HTML content.')} />
        );

      case 'divider':
        return (
          <hr
            style={{
              border: 0,
              borderTop: '1px solid var(--portal-border, #e5e7eb)',
              margin: '16px 0',
            }}
          />
        );

      case 'spacer':
        return <div style={{ height: meta.settings?.height || 48 }} />;

      default:
        return (
          <Empty
            description={t('Block type: %s', BLOCK_TYPE_LABELS[blockType] || blockType)}
          />
        );
    }
  };

  return (
    <Draggable
      component={component}
      parentComponent={parentComponent}
      orientation={parentComponent.type === ROW_TYPE ? 'column' : 'row'}
      index={index}
      depth={depth}
      onDrop={handleComponentDrop}
      editMode={editMode}
    >
      {({ dragSourceRef }: { dragSourceRef: ConnectDragSource }) => (
        <WithPopoverMenu
          menuItems={[]}
          editMode={editMode}
        >
          <div
            data-test={`dashboard-block-${blockType}`}
            className={cx('dashboard-component', 'dashboard-component-block')}
            id={component.id}
          >
            <ResizableContainer
              id={component.id}
              editMode={editMode}
              adjustableWidth={parentComponent.type === ROW_TYPE}
              widthStep={columnWidth}
              widthMultiple={widthMultiple}
              heightStep={GRID_BASE_UNIT}
              adjustableHeight
              heightMultiple={component.meta.height}
              minWidthMultiple={GRID_MIN_COLUMN_COUNT}
              minHeightMultiple={GRID_MIN_COLUMN_COUNT}
              maxWidthMultiple={availableColumnCount + widthMultiple}
              onResizeStart={onResizeStart}
              onResize={onResize}
              onResizeStop={onResizeStop}
            >
              <div
                ref={dragSourceRef}
                className="dashboard-component dashboard-component-chart-holder"
              >
                {editMode && (
                  <HoverMenu position="top">
                    <DeleteComponentButton onDelete={handleDeleteComponent} />
                  </HoverMenu>
                )}
                <BlockContainer>
                  {editMode && (
                    <span className="block-type-badge">
                      {BLOCK_TYPE_LABELS[blockType] || blockType}
                    </span>
                  )}
                  {renderBlockContent()}
                </BlockContainer>
              </div>
            </ResizableContainer>
          </div>
        </WithPopoverMenu>
      )}
    </Draggable>
  );
};

export default Block;
