# DHIS2 Connection UI Update - Complete

## ✅ Implemented Features

### 1. Improved Connection Form Fields

**Primary Field - DHIS2 URL**
- **Field Name**: `host`
- **Label**: DHIS2 Server URL
- **Description**: Full DHIS2 URL including instance path
- **Examples**:
  - `https://play.dhis2.org/40.2.2`
  - `https://dhis2.hispuganda.org/hmis`
  - `https://tests.dhis2.hispuganda.org/stable`
- **Placeholder**: `https://play.dhis2.org/40.2.2`

**Authentication Type Selector**
- **Field Name**: `authentication_type`
- **Type**: Dropdown/Radio
- **Options**:
  - `basic` - "Basic Auth (Username/Password)"
  - `pat` - "Personal Access Token (PAT)"
- **Default**: `basic`

**Conditional Fields (Basic Auth)**
- **Show when**: `authentication_type == "basic"`
- **Fields**:
  - `username` - DHIS2 Username (e.g., "admin")
  - `password` - DHIS2 Password (e.g., "district")

**Conditional Fields (PAT Auth)**
- **Show when**: `authentication_type == "pat"`
- **Fields**:
  - `access_token` - Personal Access Token (e.g., "d2pat_xxxxx...")

---

### 2. Test Connection Feature

**Method**: `test_connection(parameters, encrypted_extra)`

**What it does**:
1. Validates required fields are present
2. Constructs DHIS2 API URL from the host field
3. Tests connection by calling `/api/me` endpoint
4. Returns user information on success
5. Provides clear error messages on failure

**Error Messages**:
```
Authentication failed. Please check your credentials.
DHIS2 API not found at {url}. Please check the URL.
Cannot connect to {url}. Please check the URL and network connection.
Connection timed out. The server may be slow or unreachable.
```

---

### 3. URL Parsing and Construction

**Input**: User enters full URL
```
https://play.dhis2.org/40.2.2
https://dhis2.hispuganda.org/hmis
tests.dhis2.hispuganda.org/stable  (auto-adds https://)
```

**Processing**:
1. Auto-add `https://` if missing
2. Extract hostname and path
3. Ensure path ends with `/api`
4. Construct SQLAlchemy URI: `dhis2://credentials@hostname/path/api`

**Examples**:

| User Input | Generated URI |
|------------|---------------|
| `https://play.dhis2.org/40.2.2` | `dhis2://admin:district@play.dhis2.org/40.2.2/api` |
| `https://dhis2.hispuganda.org/hmis` | `dhis2://admin:district@dhis2.hispuganda.org/hmis/api` |
| `tests.dhis2.hispuganda.org/stable` | `dhis2://admin:district@tests.dhis2.hispuganda.org/stable/api` |

---

### 4. Reverse URI Parsing

**Purpose**: Display saved connection details in the edit form

**Input**: `dhis2://admin:district@play.dhis2.org/40.2.2/api`

**Output**:
```python
{
    "host": "https://play.dhis2.org/40.2.2",
    "authentication_type": "basic",
    "username": "admin",
    "password": "district",
    "access_token": ""
}
```

---

## 🎨 UI Form Layout

### Visual Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Add DHIS2 Database Connection                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Database Name: *                                           │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Uganda DHIS2 Production                            │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  DHIS2 Server URL: *                                        │
│  ┌────────────────────────────────────────────────────┐    │
│  │ https://dhis2.hispuganda.org/hmis                  │    │
│  └────────────────────────────────────────────────────┘    │
│  (e.g., https://play.dhis2.org/40.2.2)                     │
│                                                              │
│  Authentication Type: *                                     │
│  ○ Basic Auth (Username/Password)                          │
│  ○ Personal Access Token (PAT)                             │
│                                                              │
│  ┌─── When Basic Auth selected ──────────────────────┐    │
│  │  Username: *                                       │    │
│  │  ┌────────────────────────────────────────────┐   │    │
│  │  │ admin                                      │   │    │
│  │  └────────────────────────────────────────────┘   │    │
│  │                                                    │    │
│  │  Password: *                                       │    │
│  │  ┌────────────────────────────────────────────┐   │    │
│  │  │ ••••••••                                   │   │    │
│  │  └────────────────────────────────────────────┘   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─── When PAT selected ──────────────────────────────┐    │
│  │  Personal Access Token: *                          │    │
│  │  ┌────────────────────────────────────────────┐   │    │
│  │  │ d2pat_xxxxxxxxxxxxxxxxxxxxx                │   │    │
│  │  └────────────────────────────────────────────┘   │    │
│  │  (Get from: User Settings → Personal Access Tokens)   │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Test Connection  │  │      Save        │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Field Validation

### Required Fields

**Always Required**:
- `host` - DHIS2 Server URL

**Conditionally Required**:
- When `authentication_type == "basic"`:
  - `username` - Cannot be empty
  - `password` - Cannot be empty
- When `authentication_type == "pat"`:
  - `access_token` - Cannot be empty

### Validation Rules

```python
# Host validation
if not parameters.get("host"):
    raise ValueError("DHIS2 URL is required")

# Auth validation
auth_type = parameters.get("authentication_type", "basic")

if auth_type == "basic":
    if not parameters.get("username"):
        raise ValueError("Username is required for Basic authentication")
    if not parameters.get("password"):
        raise ValueError("Password is required for Basic authentication")
        
elif auth_type == "pat":
    if not parameters.get("access_token"):
        raise ValueError("Personal Access Token is required for PAT authentication")
```

---

## 🧪 Test Connection Flow

### User Clicks "Test Connection"

1. **Frontend** collects form data:
   ```javascript
   {
     host: "https://dhis2.hispuganda.org/hmis",
     authentication_type: "basic",
     username: "admin",
     password: "district"
   }
   ```

2. **Backend** calls `test_connection(parameters)`:
   ```python
   # Parse URL
   base_url = "https://dhis2.hispuganda.org/hmis/api"
   
   # Setup auth
   auth = ("admin", "district")  # Basic
   # OR
   headers = {"Authorization": "ApiToken d2pat_xxx"}  # PAT
   
   # Test connection
   response = requests.get(f"{base_url}/me", auth=auth, headers=headers)
   ```

3. **Success Response**:
   ```
   ✅ Connection successful!
   Connected as: John Doe (admin)
   ```

4. **Failure Response**:
   ```
   ❌ Authentication failed. Please check your credentials.
   ```

---

## 🔄 Connection Workflow

### Creating a New Connection

1. **User** fills in form:
   - URL: `https://play.dhis2.org/40.2.2`
   - Auth Type: Basic Auth
   - Username: `admin`
   - Password: `district`

2. **User** clicks "Test Connection"
   - Validates fields
   - Tests `/api/me` endpoint
   - Shows success/error message

3. **User** clicks "Save"
   - Constructs URI: `dhis2://admin:district@play.dhis2.org/40.2.2/api`
   - Saves to database

### Editing an Existing Connection

1. **System** loads saved URI: `dhis2://admin:district@play.dhis2.org/40.2.2/api`

2. **System** parses URI → form fields:
   - `host`: `https://play.dhis2.org/40.2.2`
   - `authentication_type`: `basic`
   - `username`: `admin`
   - `password`: `district` (encrypted)

3. **User** sees pre-filled form

4. **User** can edit and save

---

## 🎯 Key Improvements

### Before

```
❌ Separate server and api_path fields (confusing)
❌ No auth type selector
❌ Username/password always visible
❌ No test connection button
❌ Generic error messages
```

### After

```
✅ Single URL field (user-friendly)
✅ Auth type selector (Basic/PAT)
✅ Conditional fields (clean UI)
✅ Test connection with clear feedback
✅ Specific, actionable error messages
✅ Auto-generates proper SQLAlchemy URI
```

---

## 📊 Example Connection Scenarios

### Scenario 1: Play DHIS2 Demo

```
URL: https://play.dhis2.org/40.2.2
Auth: Basic Auth
Username: admin
Password: district

Generated URI: dhis2://admin:district@play.dhis2.org/40.2.2/api
Test Endpoint: https://play.dhis2.org/40.2.2/api/me
```

### Scenario 2: Uganda Production (with instance path)

```
URL: https://dhis2.hispuganda.org/hmis
Auth: Basic Auth
Username: datamanager
Password: ********

Generated URI: dhis2://datamanager:password@dhis2.hispuganda.org/hmis/api
Test Endpoint: https://dhis2.hispuganda.org/hmis/api/me
```

### Scenario 3: Using PAT

```
URL: https://tests.dhis2.hispuganda.org/stable
Auth: Personal Access Token
Token: d2pat_5xVA12xyUbWNedQxy4ohH77WlxRGVvZZ1151814092

Generated URI: dhis2://:d2pat_5xVA12xyUbWNedQxy4ohH77WlxRGVvZZ1151814092@tests.dhis2.hispuganda.org/stable/api
Test Endpoint: https://tests.dhis2.hispuganda.org/stable/api/me
```

---

## 🔧 Technical Implementation

### Files Modified

- **`superset/db_engine_specs/dhis2.py`**:
  - Updated `DHIS2ParametersSchema` with new fields
  - Added `test_connection()` method
  - Updated `build_sqlalchemy_uri()` for new field names
  - Updated `get_parameters_from_uri()` for reverse parsing

### Schema Fields

```python
class DHIS2ParametersSchema(Schema):
    # Primary connection
    host = fields.Str(required=True)
    
    # Auth selector
    authentication_type = fields.Str(validate=OneOf(["basic", "pat"]))
    
    # Conditional Basic Auth
    username = fields.Str(visibleIf={"authentication_type": "basic"})
    password = EncryptedString(visibleIf={"authentication_type": "basic"})
    
    # Conditional PAT
    access_token = EncryptedString(visibleIf={"authentication_type": "pat"})
```

---

## ✅ Testing Checklist

- [ ] Form displays URL field
- [ ] Auth type selector shows both options
- [ ] Username/password fields show only for Basic Auth
- [ ] Access token field shows only for PAT
- [ ] Test Connection button works
- [ ] Success message shows on successful test
- [ ] Error message shows on failed test
- [ ] Save creates proper SQLAlchemy URI
- [ ] Edit loads correct field values
- [ ] URL with instance path works
- [ ] URL without https:// auto-adds it

---

## 🚀 Ready to Use!

The DHIS2 connection UI now has:
- ✅ Clean, user-friendly URL input
- ✅ Auth type selection (Basic/PAT)
- ✅ Conditional field display
- ✅ Test connection feature
- ✅ Clear error messages
- ✅ Proper URI generation

**Next**: Restart Superset and test the new connection form!

