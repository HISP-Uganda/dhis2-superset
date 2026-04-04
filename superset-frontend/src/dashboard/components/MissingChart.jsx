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
import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { t, useTheme } from '@superset-ui/core';

const propTypes = {
  height: PropTypes.number.isRequired,
};

export default function MissingChart({ height }) {
  const theme = useTheme();
  const [showMessage, setShowMessage] = useState(false);

  // Wait a few seconds before showing the delete message — the chart
  // may still be loading from the server after a dashboard refresh.
  useEffect(() => {
    const timer = setTimeout(() => setShowMessage(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="missing-chart-container"
      style={{
        height: Math.max(height, 60),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="missing-chart-body"
        style={{
          textAlign: 'center',
          color: theme?.colorTextDescription || '#6B7280',
          fontSize: 13,
          lineHeight: 1.6,
          maxWidth: 320,
        }}
      >
        {showMessage ? (
          <>
            <div style={{
              fontSize: 20,
              marginBottom: 8,
              color: theme?.colorWarning || '#F9A825',
            }}>
              ⚠
            </div>
            {t('Chart data could not be loaded. The chart may have been deleted.')}
            <br />
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              {t('Remove this component in edit mode to clear this placeholder.')}
            </span>
          </>
        ) : (
          <span style={{ opacity: 0.6 }}>
            {t('Loading chart data…')}
          </span>
        )}
      </div>
    </div>
  );
}

MissingChart.propTypes = propTypes;
