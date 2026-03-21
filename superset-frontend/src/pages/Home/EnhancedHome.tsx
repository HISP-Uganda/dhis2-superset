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

import { useState } from 'react';
import { styled } from '@superset-ui/core';
import DataSourceSidebar, {
  type Dashboard,
} from 'src/features/home/DataSourceSidebar';
import DashboardContentArea from 'src/features/home/DashboardContentArea';

const PageContainer = styled.div`
  display: flex;
  width: 100%;
  min-height: calc(100vh - 60px);
  position: relative;
  margin-top: 60px; /* Account for fixed navbar */
`;

export default function EnhancedHome() {
  const [selectedDashboard, setSelectedDashboard] = useState<
    Dashboard | undefined
  >(undefined);

  const handleDashboardSelect = (dashboard: Dashboard) => {
    setSelectedDashboard(dashboard);
  };

  return (
    <PageContainer>
      <DataSourceSidebar
        selectedKey={selectedDashboard?.id.toString()}
        onSelect={handleDashboardSelect}
      />
      {selectedDashboard && (
        <DashboardContentArea selectedDashboard={selectedDashboard} />
      )}
    </PageContainer>
  );
}
