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

import SequentialScheme from '../../SequentialScheme';

const schemes = [
  {
    id: 'dhis2_ylorrd',
    label: 'DHIS2 Yellow-Orange-Red',
    colors: ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'],
  },
  {
    id: 'dhis2_blues',
    label: 'DHIS2 Blues',
    colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
  },
  {
    id: 'dhis2_greens',
    label: 'DHIS2 Greens',
    colors: ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
  },
  {
    id: 'dhis2_rdylgn',
    label: 'DHIS2 Red-Yellow-Green',
    isDiverging: true,
    colors: ['#d73027', '#fc8d59', '#fee08b', '#ffffbf', '#d9ef8b', '#91cf60', '#1a9850'],
  },
  {
    id: 'dhis2_traffic_light',
    label: 'DHIS2 Traffic Light',
    colors: ['#ff0000', '#ffff00', '#008000'],
  },
  {
    id: 'dhis2_vibrant',
    label: 'DHIS2 Vibrant',
    colors: ['#e1f5fe', '#b3e5fc', '#81d4fa', '#4fc3f7', '#29b6f6', '#03a9f4', '#039be5', '#0288d1', '#0277bd', '#01579b'],
  },
].map(s => new SequentialScheme(s));

export default schemes;
