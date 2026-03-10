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
import { Select, Input } from 'antd';
import { LabeledErrorBoundInput as ValidatedInput } from '@superset-ui/core/components';
import { FieldPropTypes } from '../../types';

const { Option } = Select;
const { TextArea } = Input;

/**
 * Generate SQLAlchemy URI from DHIS2 parameters
 */
const generateSQLAlchemyURI = (
  host: string,
  authType: string,
  username: string,
  password: string,
  accessToken: string,
): string => {
  if (!host) {
    return 'dhis2://';
  }

  try {
    // Parse the URL to extract hostname and path
    const url = new URL(host.startsWith('http') ? host : `https://${host}`);
    const { hostname } = url;
    let path = url.pathname;

    // Ensure path ends with /api
    if (!path.endsWith('/api')) {
      path = `${path.replace(/\/$/, '')}/api`;
    }

    // Build credentials part
    let credentials = '';
    if (authType === 'basic' && username) {
      credentials = password
        ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
        : encodeURIComponent(username);
    } else if (authType === 'pat' && accessToken) {
      credentials = `:${encodeURIComponent(accessToken)}`;
    }

    // Build full URI
    const credentialsPart = credentials ? `${credentials}@` : '';
    return `dhis2://${credentialsPart}${hostname}${path}`;
  } catch (e) {
    // If URL parsing fails, return basic format
    return `dhis2://${host}`;
  }
};

/**
 * DHIS2 Authentication Form with Conditional Field Visibility
 *
 * This is a FUNCTION (not a component) that returns JSX
 * It's called directly by the form, so we can't use React hooks here
 */
export const DHIS2AuthenticationFields = ({
  changeMethods,
  validationErrors,
  getValidation,
  clearValidationErrors,
  db,
  isValidating,
}: FieldPropTypes) => {
  // Get current values from db.parameters (no hooks needed)
  const authType = (db?.parameters as any)?.authentication_type || 'basic';
  const host = db?.parameters?.host || '';
  const username = (db?.parameters as any)?.username || '';
  const password = (db?.parameters as any)?.password || '';
  const accessToken = (db?.parameters as any)?.access_token || '';

  // Compute SQLAlchemy URI
  const sqlalchemyURI = generateSQLAlchemyURI(
    host,
    authType,
    username,
    password,
    accessToken,
  );

  const handleAuthTypeChange = (value: string) => {
    if (clearValidationErrors) {
      clearValidationErrors();
    }
    // Update authentication type
    if (changeMethods?.onParametersChange) {
      changeMethods.onParametersChange({
        target: {
          type: 'text',
          name: 'authentication_type',
          value,
          checked: false,
        },
      });

      // Clear fields from the other auth method when switching
      if (value === 'pat') {
        // Switching to PAT, clear username and password
        changeMethods.onParametersChange({
          target: {
            type: 'text',
            name: 'username',
            value: '',
            checked: false,
          },
        });
        changeMethods.onParametersChange({
          target: {
            type: 'text',
            name: 'password',
            value: '',
            checked: false,
          },
        });
      } else {
        // Switching to basic, clear access token
        changeMethods.onParametersChange({
          target: {
            type: 'text',
            name: 'access_token',
            value: '',
            checked: false,
          },
        });
      }
    }
  };

  const handleParamChange = (event: any) => {
    if (clearValidationErrors) {
      clearValidationErrors();
    }
    changeMethods?.onParametersChange?.(event);
  };

  return (
    <>
      {/* Host Field - Always visible */}
      <ValidatedInput
        isValidating={isValidating}
        id="host"
        name="host"
        value={host}
        required
        hasTooltip
        tooltipText={t(
          'Full DHIS2 server URL including instance path if applicable',
        )}
        validationMethods={{ onBlur: getValidation }}
        errorMessage={validationErrors?.host}
        placeholder={t('https://play.dhis2.org/40.2.2')}
        label={t('DHIS2 Server URL')}
        onChange={handleParamChange}
        helpText={t(
          'Examples: https://play.dhis2.org/40.2.2 or https://dhis2.hispuganda.org/hmis',
        )}
      />

      {/* Authentication Type Selector */}
      <div className="control-label">
        {t('Authentication Type')}
        <span className="required">*</span>
      </div>
      <Select
        aria-label={t('Authentication Type')}
        value={authType}
        onChange={handleAuthTypeChange}
        style={{ width: '100%', marginBottom: '10px' }}
      >
        <Option value="basic">{t('Basic Auth (Username/Password)')}</Option>
        <Option value="pat">{t('Personal Access Token (PAT)')}</Option>
      </Select>
      <div className="helper" style={{ marginBottom: '20px' }}>
        {t('Choose how to authenticate with DHIS2')}
      </div>

      {/* Basic Auth Fields - Only show when authType is 'basic' */}
      {authType === 'basic' && (
        <>
          <ValidatedInput
            isValidating={isValidating}
            id="username"
            name="username"
            value={username}
            required={authType === 'basic'}
            hasTooltip
            tooltipText={t('DHIS2 username for Basic Authentication')}
            validationMethods={{ onBlur: getValidation }}
            errorMessage={validationErrors?.username}
            placeholder={t('admin')}
            label={t('Username')}
            onChange={handleParamChange}
            helpText={t('Enter your DHIS2 username')}
          />

          <ValidatedInput
            isValidating={isValidating}
            id="password"
            name="password"
            type="password"
            value={password}
            required={authType === 'basic'}
            hasTooltip
            tooltipText={t('DHIS2 password for Basic Authentication')}
            validationMethods={{ onBlur: getValidation }}
            errorMessage={validationErrors?.password}
            placeholder={t('district')}
            label={t('Password')}
            onChange={handleParamChange}
            helpText={t('Enter your DHIS2 password')}
          />
        </>
      )}

      {/* PAT Field - Only show when authType is 'pat' */}
      {authType === 'pat' && (
        <ValidatedInput
          isValidating={isValidating}
          id="access_token"
          name="access_token"
          type="password"
          value={accessToken}
          required={authType === 'pat'}
          hasTooltip
          tooltipText={t(
            'Personal Access Token from DHIS2 (Settings → Personal Access Tokens)',
          )}
          validationMethods={{ onBlur: getValidation }}
          errorMessage={validationErrors?.access_token}
          placeholder={t('d2pat_xxxxxxxxxxxxxxxxxxxxx')}
        label={t('Personal Access Token')}
        onChange={handleParamChange}
          helpText={t(
            'Generate a token in DHIS2: User Settings → Personal Access Tokens',
          )}
        />
      )}

      {/* SQLAlchemy URI Display - Read-only */}
      <div style={{ marginTop: '20px' }}>
        <div className="control-label">{t('SQLAlchemy URI (Generated)')}</div>
        <TextArea
          value={sqlalchemyURI}
          readOnly
          autoSize={{ minRows: 2, maxRows: 4 }}
          style={{
            backgroundColor: '#f5f5f5',
            color: '#666',
            cursor: 'not-allowed',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        />
        <div className="helper">
          {t(
            'This URI is automatically generated from the fields above and will be used to connect to DHIS2',
          )}
        </div>
      </div>
    </>
  );
};
