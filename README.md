# Get New Relic usage from multiple accounts and push to NRDB as custom Metric

This repo show how you can use `New Relic Scripted API Synthetics` to pull New Relic Usage from multiple accounts.

## How does it work?

This NodeJs script uses New Relic Nerdgraph GraphQL to query Full User, Core User and Gigabytes Ingested usage stats for each configured NR Account and pushed the results to NRDB as custom metrics. Once in NRDB, you can creat usage dashboard for multiple accounts.

This is the script that will be executed against each account

```sql
FROM NrConsumption, NrMTDConsumption SELECT
filter(
    sum(GigabytesIngested), 
    WHERE productLine = 'DataPlatform' AND eventType() = 'NrConsumption') 
    as 'GigabytesIngested', 
filter(
    latest(consumption), 
    WHERE (metric = 'FullUsers' or metric = 'FullPlatformUsers') AND eventType() = 'NrMTDConsumption') 
    AS 'FullUsers', 
filter(
    latest(CoreUsersBillable), 
    WHERE productLine = 'FullStackObservability' AND eventType() = 'NrMTDConsumption') 
    AS 'CoreUsers' 
SINCE 1 days ago
```

## Step 1: Setup Secured Credentials

Go to `New Relic One > Synthetics Monitors` and create the following `Secure credentials`:

-   `YOUR_INSERT_KEY` : Your Insights insert keys (go to NR Api Keys and click on `Insights insert keys` link on the right) and copy the Insert Keys

## Step 2: Create new Scripted API Synthetics

-   Go to Synthetics and create new Scripted API Synthetics
-   **Important**: Select `Node 10 (Legacy)` as run time
-   Select `1 day` as frequency (you don't want to run this more often than once a day)
-   Select your location (only 1 location is required)
-   Copy the content of the `index.js` file to the Script Editor
-   Modify the following:
    -   `YOU_RPM_ACCOUNT`: all usage metrics will be pushed to this account
    -   `accounts`: list of all RPM accounts to run the NrConsumption query against in format `Customer_Name:RPM_Account_ID:UserApiKey`.
    - **Note**: make sure you use the `correct` RPM_Account_ID and UserApiKey. The RPM_Account_ID must be the master account which contains FSO usage metrics and UserApiKey must be of the user who has access to that account.
-   Click Validate and Save script

## Troubleshooting Errors

Script can fail because of the following reasons:

-   **Wrong run time selected**: make sure you select the Legacy run time `Node 10 (Legacy)`
-   **Invalid User API key**: make sure you use correct user api key. This user must have access to the provided Master RPM account ID and can query the usage data
