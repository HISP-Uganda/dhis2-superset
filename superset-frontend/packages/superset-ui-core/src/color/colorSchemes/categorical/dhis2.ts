/*
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

import CategoricalScheme from '../../CategoricalScheme';

const schemes = [
  {
    id: 'dhis2_standard',
    label: 'DHIS2 Standard',
    colors: [
      '#1d5288',
      '#4ea2d9',
      '#75b0fb',
      '#ff9800',
      '#ffc107',
      '#4caf50',
      '#8bc34a',
      '#f44336',
      '#e91e63',
      '#9c27b0',
    ],
  },
  {
    id: 'dhis2_vibrant_categorical',
    label: 'DHIS2 Vibrant Categorical',
    colors: [
      '#00bcd4',
      '#009688',
      '#3f51b5',
      '#673ab7',
      '#ff5722',
      '#795548',
      '#607d8b',
      '#333333',
    ],
  },
].map(s => new CategoricalScheme(s));

export default schemes;
