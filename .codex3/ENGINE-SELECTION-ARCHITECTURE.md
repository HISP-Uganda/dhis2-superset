# ENGINE-SELECTION-ARCHITECTURE.md
## Engine Selection and Activation Rules

## 1. Single active engine policy
The platform supports multiple staging engines but only one may be active at a time.

## 2. Admin authority
Only admins or equivalent privileged roles may:
- enable/disable local staging globally
- select the active engine
- configure engine-specific settings
- enable/disable retention policy
- configure retention parameters

## 3. Dataset behavior
When a staged dataset is created, updated, or refreshed:
- the system reads the active platform-wide staging engine
- the selected engine is used automatically
- the dataset must not override the engine if only one platform-wide engine is supported at a time

## 4. Switching behavior
Switching the active engine must:
- be explicit
- warn that staged datasets may require rebuild
- preserve metadata
- avoid silent destructive cleanup
- expose stale/rebuild state clearly

## 5. Health and validation
Each engine must support:
- config validation
- connectivity/health validation
- status reporting
- version/capability reporting where feasible
