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
import { styled } from '@superset-ui/core';

const ChartContainer = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
`;

const ChartIframe = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
  display: block;
`;

interface PublicChartRendererProps {
  chartId: number;
  chartName: string;
  isPublic: boolean;
}

export default function PublicChartRenderer({
  chartId,
  chartName,
}: PublicChartRendererProps) {
  // Use Superset's native chart embedding via iframe
  // This approach is simpler and more reliable than using SuperChart directly
  // because it leverages Superset's existing rendering infrastructure
  const embedUrl = `/superset/explore/public/?slice_id=${chartId}&standalone=true`;

  return (
    <ChartContainer>
      <ChartIframe
        src={embedUrl}
        title={chartName}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        loading="lazy"
      />
    </ChartContainer>
  );
}
