# InstantRailCheck

## Mission

Build the most trusted crowdsourced database of real-world bank transfer compatibility.

## MVP Scope

InstantRailCheck answers one core question:

Can Bank A send money instantly to Bank B?

## Version 1 Features

- Search sender bank to receiver bank
- View route result
- Submit transfer report
- Track rail used: RTP, FedNow, ACH, Wire, Zelle, Other, Unknown
- Track direction: Push or Pull
- Track date tested
- Track confidence based on reports

## Data Principles

- Real-world reports only
- No guessing
- Unknown is better than wrong
- Show test dates clearly
- Stale data should be marked stale

## Seed Routes

- Chase to Gesa Credit Union: RTP confirmed
- Chase to SoFi: ACH observed
- Chase to Fidelity CMA: ACH observed
- Chase to Schwab: ACH observed
- Chase to BECU: ACH observed
- Chase to WSECU: ACH observed
- Chase to American Express Rewards Checking: ACH observed

## Build Rules

- Small commits
- Test before pushing
- Keep MVP focused
- No feature creep