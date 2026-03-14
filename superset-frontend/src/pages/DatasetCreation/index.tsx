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
import { useEffect, useState, type Dispatch } from 'react';
import { useParams } from 'react-router-dom';

import Header from 'src/features/datasets/AddDataset/Header';
import EditPage from 'src/features/datasets/AddDataset/EditDataset';
import BranchingDatasetWizard from 'src/features/datasets/AddDataset/BranchingDatasetWizard';
import type { DSReducerActionType } from 'src/features/datasets/AddDataset/types';
import DatasetLayout from 'src/features/datasets/DatasetLayout';

const PRESET_EDIT_TITLE = 'Dataset';
const NOOP_SET_DATASET = (() => undefined) as Dispatch<DSReducerActionType>;

export default function DatasetCreationPage() {
  const { datasetId: id } = useParams<{ datasetId: string }>();
  const [editPageIsVisible, setEditPageIsVisible] = useState(false);

  useEffect(() => {
    setEditPageIsVisible(!Number.isNaN(parseInt(id, 10)));
  }, [id]);

  if (!editPageIsVisible) {
    return <BranchingDatasetWizard />;
  }

  return (
    <DatasetLayout
      datasetPanel={<EditPage id={id} />}
      header={
        <Header
          editing
          setDataset={NOOP_SET_DATASET}
          title={PRESET_EDIT_TITLE}
        />
      }
    />
  );
}
