# Observability and Status Requirements

## Required metrics and timings
- DHIS2 extraction duration
- raw landing insert duration
- staging normalization duration
- serving refresh duration
- row counts loaded per sync
- row counts transformed per sync
- row counts served per sync
- retry count
- failure count
- active serving version or generation

## Required logs
- sync job start
- sync job completion
- sync job failure
- refresh scope chosen
- serving promotion event
- configuration warnings
- fallback warnings

## Required operator-visible states
- queued
- running
- succeeded
- partially failed
- failed
- rolled back
- serving promotion pending
- serving promotion complete

## Status reporting requirement
The code and docs must make it easy to answer:
- What data is current?
- What failed?
- What is stale?
- Which serving build is live?
- Which partitions or scopes were refreshed?
