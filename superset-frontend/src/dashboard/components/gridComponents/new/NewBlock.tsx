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
import { t } from '@superset-ui/core';
import { Icons } from '@superset-ui/core/components';
import { BLOCK_TYPE } from '../../../util/componentTypes';
import { NEW_BLOCK_ID } from '../../../util/constants';
import DraggableNewComponent from './DraggableNewComponent';

interface BlockDefinition {
  key: string;
  label: string;
  icon: any;
  blockType: string;
}

const BLOCK_DEFINITIONS: BlockDefinition[] = [
  {
    key: 'rich_text',
    label: 'Rich Text Block',
    icon: Icons.FileTextOutlined,
    blockType: 'rich_text',
  },
  {
    key: 'heading',
    label: 'Heading Block',
    icon: Icons.FontColorsOutlined,
    blockType: 'heading',
  },
  {
    key: 'callout',
    label: 'Callout Block',
    icon: Icons.ExclamationCircleOutlined,
    blockType: 'callout',
  },
  {
    key: 'statistic',
    label: 'Statistic Block',
    icon: Icons.NumberOutlined,
    blockType: 'statistic',
  },
  {
    key: 'quote',
    label: 'Quote Block',
    icon: Icons.HighlightOutlined,
    blockType: 'quote',
  },
  {
    key: 'image',
    label: 'Image Block',
    icon: Icons.FileImageOutlined,
    blockType: 'image',
  },
  {
    key: 'embed',
    label: 'Embed / Video Block',
    icon: Icons.MonitorOutlined,
    blockType: 'embed',
  },
  {
    key: 'html',
    label: 'HTML Block',
    icon: Icons.FormOutlined,
    blockType: 'html',
  },
];

export function NewBlockItem({ blockDef }: { blockDef: BlockDefinition }) {
  return (
    <DraggableNewComponent
      id={`${NEW_BLOCK_ID}-${blockDef.key}`}
      type={BLOCK_TYPE}
      label={t(blockDef.label)}
      meta={{ blockType: blockDef.blockType }}
      IconComponent={blockDef.icon}
    />
  );
}

export default function NewBlocks() {
  return (
    <>
      {BLOCK_DEFINITIONS.map(def => (
        <NewBlockItem key={def.key} blockDef={def} />
      ))}
    </>
  );
}

export { BLOCK_DEFINITIONS };
