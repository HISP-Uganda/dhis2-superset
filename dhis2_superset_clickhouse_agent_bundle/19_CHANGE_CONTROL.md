# Change Control

## Required discipline
- Make structural changes intentionally.
- Document breaking or behaviorally significant changes.
- Preserve existing names where practical unless performance or correctness demands change.
- Update docs in the same change set as code.

## Decision logging
The implementation should document key choices such as:
- refresh semantics chosen
- partition and ordering strategy chosen
- serving mart grouping chosen
- map-serving strategy chosen
- backward compatibility strategy chosen
