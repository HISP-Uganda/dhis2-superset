# REST API & DHIS2 Integration Guide - Uganda Malaria Superset

**Date**: October 31, 2025
**Status**: ✅ Ready to Configure

---

## Overview

Superset can connect to REST APIs and JSON endpoints to fetch data dynamically. This is crucial for:
- **DHIS2 Integration** - Uganda's Health Management Information System
- **External Health APIs** - WHO, CDC, other data sources
- **Custom MOH APIs** - Internal data services
- **Real-time Data Feeds** - Live malaria surveillance data

---

## Method 1: Connect to REST APIs via Shillelagh

Shillelagh allows you to query REST APIs like SQL tables.

### Quick Test - Public API Example

Let's test with a simple public API first to verify everything works.

#### Step 1: Add Generic API Database Connection

1. **Go to**: http://localhost:8088
2. **Navigate to**: Data → Databases → + Database
3. **Select**: **Other** (from database types)
4. **Configure**:

   **Display Name**: `REST APIs`

   **SQLAlchemy URI**:
   ```
   shillelagh://
   ```

5. **Click**: Test Connection → Connect

#### Step 2: Query API Data in SQL Lab

1. **Go to**: SQL Lab → SQL Editor
2. **Select Database**: REST APIs
3. **Try this query** (example with public WHO API):

   ```sql
   SELECT * FROM "https://disease.sh/v3/covid-19/countries/Uganda"
   ```

4. **Run Query**

This should return Uganda's COVID-19 data as a table!

---

## Method 2: DHIS2 Integration (Uganda HMIS)

DHIS2 is Uganda's primary health data system. Here's how to connect it to Superset.

### Prerequisites

You need:
- DHIS2 server URL (e.g., `https://hmis.health.go.ug/api/`)
- Username and password with API access
- API endpoint knowledge (which indicators to fetch)

### Option A: Using Shillelagh (Simpler)

#### Step 1: Test DHIS2 API Access

First, verify you can access the DHIS2 API:

```bash
curl -u "username:password" "https://hmis.health.go.ug/api/dataValueSets?dataSet=MALARIA_DATASET&period=202501&orgUnit=UGANDA"
```

Replace with your credentials and correct endpoint.

#### Step 2: Connect via Shillelagh

1. **Add Database Connection**:
   - Display Name: `Uganda HMIS DHIS2`
   - SQLAlchemy URI: `shillelagh://`

2. **Query in SQL Lab**:
   ```sql
   SELECT * FROM "https://hmis.health.go.ug/api/dataValueSets.json?dataSet=MALARIA&period=202501&orgUnit=UGANDA"
   ```

**Note**: You'll need to handle authentication. See authentication section below.

### Option B: Using dhis2.py Library (More Features)

This gives you better DHIS2 integration with proper authentication and data extraction.

#### Step 1: Install dhis2.py Library

```bash
docker exec superset_app pip install dhis2.py
```

#### Step 2: Create Python Script to Fetch DHIS2 Data

Create a data pipeline script:

```python
# /app/superset_home/dhis2_fetcher.py
from dhis2 import Api
import pandas as pd

# DHIS2 Configuration
api = Api(
    'https://hmis.health.go.ug',
    'your_username',
    'your_password'
)

# Fetch Malaria Data
def fetch_malaria_indicators():
    # Example: Fetch malaria data values
    params = {
        'dataSet': 'MALARIA_MONTHLY',
        'period': '202501',
        'orgUnit': 'UGANDA'
    }

    data = api.get('dataValueSets', params=params).json()

    # Convert to DataFrame
    df = pd.DataFrame(data['dataValues'])
    return df

# Fetch and save to database
df = fetch_malaria_indicators()
# Save to PostgreSQL (uganda_dwh)
df.to_sql('dhis2_malaria_data', engine, if_exists='replace')
```

#### Step 3: Schedule Regular Updates

Use Celery (already configured in Superset) to schedule data fetches:

```python
# In superset_config.py
CELERY_BEAT_SCHEDULE = {
    'fetch-dhis2-malaria-data': {
        'task': 'fetch_dhis2_data',
        'schedule': crontab(minute=0, hour='*/6'),  # Every 6 hours
    },
}
```

---

## DHIS2 API Endpoints (Uganda HMIS)

Common endpoints for malaria data:

### 1. Data Values
Fetch actual indicator values:
```
GET /api/dataValueSets?dataSet={dataSetId}&period={period}&orgUnit={orgUnitId}
```

### 2. Indicators
Get list of malaria indicators:
```
GET /api/indicators?filter=name:ilike:malaria
```

### 3. Organization Units
Get districts/facilities:
```
GET /api/organisationUnits?level=3
```

### 4. Data Elements
Get malaria data elements:
```
GET /api/dataElements?filter=domainType:eq:AGGREGATE&filter=name:ilike:malaria
```

### Example DHIS2 Malaria Indicators

Common Uganda malaria indicators:
- `Malaria_Suspected` - Suspected malaria cases (fever)
- `Malaria_Tested_Microscopy` - Tested by blood smear
- `Malaria_Tested_RDT` - Tested by RDT
- `Malaria_Confirmed` - Confirmed positive cases
- `Malaria_Treated` - Cases treated with ACT
- `Malaria_Deaths` - Malaria deaths
- `IPTp_Doses` - IPTp doses given to pregnant women

---

## Authentication Methods

### Method 1: Basic Auth in URL (Not Recommended - Insecure)

```
https://username:password@hmis.health.go.ug/api/dataValueSets
```

❌ **Don't use in production** - credentials visible in logs

### Method 2: Environment Variables (Recommended)

In `docker-compose.yml`:
```yaml
environment:
  - DHIS2_URL=https://hmis.health.go.ug
  - DHIS2_USERNAME=your_username
  - DHIS2_PASSWORD=your_password
```

In your Python script:
```python
import os
dhis2_url = os.getenv('DHIS2_URL')
dhis2_user = os.getenv('DHIS2_USERNAME')
dhis2_pass = os.getenv('DHIS2_PASSWORD')
```

### Method 3: Personal Access Token (Best)

DHIS2 supports API tokens:

1. **Generate Token** in DHIS2:
   - Go to Profile → Personal Access Tokens
   - Create new token
   - Copy token

2. **Use in API Calls**:
   ```bash
   curl -H "Authorization: ApiToken YOUR_TOKEN" \
     "https://hmis.health.go.ug/api/dataValueSets"
   ```

---

## Example Integration: Malaria Weekly Report

### Scenario
Fetch weekly malaria data from DHIS2 and display in Superset dashboard.

### Step 1: Identify DHIS2 Data Elements

Common malaria data elements in Uganda HMIS:
- 105-EP01a: Suspected Malaria (fever)
- 105-EP01b: Malaria Tested (Microscopy + RDT)
- 105-EP01c: Malaria Confirmed
- 105-EP01d: Malaria Treated
- 105-EP01e: Total Malaria Cases

### Step 2: Fetch Data from DHIS2 API

```python
import requests
import pandas as pd
from datetime import datetime, timedelta

# DHIS2 Configuration
DHIS2_URL = "https://hmis.health.go.ug/api"
USERNAME = "your_username"
PASSWORD = "your_password"

# Calculate period (last 4 weeks)
periods = []
for i in range(4):
    week_start = datetime.now() - timedelta(weeks=i)
    period = week_start.strftime("%YW%U")  # e.g., 2025W04
    periods.append(period)

# Fetch data
data_elements = [
    "EP01a_Suspected",
    "EP01b_Tested",
    "EP01c_Confirmed",
    "EP01d_Treated"
]

all_data = []

for period in periods:
    for de in data_elements:
        response = requests.get(
            f"{DHIS2_URL}/dataValueSets",
            params={
                'dataElement': de,
                'period': period,
                'orgUnit': 'UGANDA'
            },
            auth=(USERNAME, PASSWORD)
        )

        if response.status_code == 200:
            data = response.json()
            all_data.extend(data.get('dataValues', []))

# Convert to DataFrame
df = pd.DataFrame(all_data)
df.to_csv('/tmp/malaria_weekly.csv', index=False)
```

### Step 3: Load into PostgreSQL

```python
from sqlalchemy import create_engine

engine = create_engine('postgresql://postgres@host.docker.internal:5432/uganda_dwh')
df.to_sql('dhis2_malaria_weekly', engine, if_exists='replace', index=False)
```

### Step 4: Create Superset Dataset

1. Go to Data → Datasets → + Dataset
2. Select: uganda_dwh database
3. Table: dhis2_malaria_weekly
4. Create charts from this data

---

## Alternative: Using Custom SQL Database

If direct API querying is complex, you can:

1. **Create a Data Pipeline** (Python script)
2. **Fetch from DHIS2 API** regularly
3. **Store in PostgreSQL** (uganda_dwh)
4. **Query from Superset** (standard SQL)

### Advantages:
- ✅ Better performance (cached data)
- ✅ Can transform/clean data before visualization
- ✅ Handles authentication securely
- ✅ Can combine multiple API sources
- ✅ Works offline (cached data)

### Setup Script Example:

```python
#!/usr/bin/env python3
# /app/superset_home/sync_dhis2.py

import requests
import pandas as pd
from sqlalchemy import create_engine
import os

# Configuration
DHIS2_URL = os.getenv('DHIS2_URL', 'https://hmis.health.go.ug/api')
DHIS2_USER = os.getenv('DHIS2_USERNAME')
DHIS2_PASS = os.getenv('DHIS2_PASSWORD')
DB_URI = 'postgresql://postgres@host.docker.internal:5432/uganda_dwh'

def fetch_dhis2_malaria_data():
    """Fetch malaria indicators from DHIS2"""

    # Data elements to fetch
    indicators = {
        'EP01a': 'Suspected Malaria',
        'EP01b': 'Malaria Tested',
        'EP01c': 'Malaria Confirmed',
        'EP01d': 'Malaria Treated'
    }

    # Periods (last 12 months)
    periods = [f"2025{str(i).zfill(2)}" for i in range(1, 13)]

    all_data = []

    for code, name in indicators.items():
        for period in periods:
            response = requests.get(
                f"{DHIS2_URL}/dataValueSets",
                params={
                    'dataElement': code,
                    'period': period,
                    'orgUnit': 'UG'  # Uganda
                },
                auth=(DHIS2_USER, DHIS2_PASS),
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                for dv in data.get('dataValues', []):
                    all_data.append({
                        'period': dv['period'],
                        'indicator': name,
                        'value': int(dv['value']),
                        'last_updated': dv.get('lastUpdated')
                    })

    return pd.DataFrame(all_data)

def save_to_database(df):
    """Save DataFrame to PostgreSQL"""
    engine = create_engine(DB_URI)
    df.to_sql('dhis2_malaria_indicators', engine, if_exists='replace', index=False)
    print(f"✅ Saved {len(df)} records to database")

if __name__ == '__main__':
    print("Fetching DHIS2 malaria data...")
    df = fetch_dhis2_malaria_data()
    save_to_database(df)
    print("✅ DHIS2 sync complete!")
```

### Schedule with Cron:

```bash
# Run every 6 hours
0 */6 * * * docker exec superset_app python3 /app/superset_home/sync_dhis2.py
```

---

## Testing Checklist

- [ ] Shillelagh REST API connection created
- [ ] Test query with public API endpoint works
- [ ] DHIS2 API credentials obtained
- [ ] DHIS2 API accessible (curl test successful)
- [ ] Data pipeline script created
- [ ] Data successfully fetched from DHIS2
- [ ] Data stored in PostgreSQL
- [ ] Superset dataset created from DHIS2 data
- [ ] Charts created from DHIS2 indicators
- [ ] Dashboard shows live/recent DHIS2 data
- [ ] Automated sync scheduled

---

## Troubleshooting

### Issue: "Connection Refused"
- Check if API URL is correct
- Verify network access (firewall/VPN)
- Test with curl first

### Issue: "401 Unauthorized"
- Check username/password
- Verify API token is valid
- Check user has API access permissions in DHIS2

### Issue: "Timeout"
- DHIS2 server may be slow
- Increase timeout in requests
- Fetch smaller date ranges

### Issue: "Data Not Updating"
- Check scheduled script is running
- Verify cron job is active
- Check Superset cache settings

---

## Security Best Practices

1. **Never commit credentials** to git
2. **Use environment variables** for sensitive data
3. **Use API tokens** instead of passwords
4. **Limit API user permissions** to read-only
5. **Use HTTPS** for all API connections
6. **Rotate credentials** regularly
7. **Monitor API usage** in DHIS2 logs

---

## Resources

**DHIS2 Documentation:**
- [DHIS2 Web API Guide](https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/web-api.html)
- [Data Value Sets API](https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/data.html#webapi_data_values)

**Uganda HMIS:**
- HMIS URL: https://hmis.health.go.ug
- Contact MOH ICT department for API access

**Superset:**
- [Database Connections](https://superset.apache.org/docs/databases/installing-database-drivers)
- [SQL Lab](https://superset.apache.org/docs/creating-charts-dashboards/exploring-data)

---

**Next Steps**:
1. Get DHIS2 API credentials from MOH
2. Test API access with curl
3. Set up data pipeline script
4. Schedule automated syncs
5. Create dashboards from DHIS2 data

---

**Last Updated**: October 31, 2025
**Status**: Ready for DHIS2 Integration
