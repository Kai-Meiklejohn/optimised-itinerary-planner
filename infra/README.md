# AWS setup for local development

The original AWS environment no longer exists. These Terraform files create a separate set of development resources in **your own AWS account**. They do not deploy a website, Lambda function or CI deployment roles.

You need Terraform 1.15 or newer, AWS CLI v2 and permission to provision Cognito, DynamoDB, Amazon Location and an IAM policy. Start in a development account without tables named `Trip` or `Stop`. The configuration creates resources rather than importing existing ones.

AWS usage can incur charges. Set a billing alert in your account before creating resources. Alerts do not cap spending.

## 1. Authenticate and create resources

Configure your own AWS CLI profile, preferably with temporary SSO credentials. Run `aws configure sso --profile itinerary-dev`, then `aws sso login --profile itinerary-dev` if your account uses IAM Identity Center. Otherwise use a credential method approved by your account administrator.

From the repository root, confirm the account and review the plan before applying it.

```bash
export AWS_PROFILE=itinerary-dev
aws sts get-caller-identity
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
terraform -chdir=infra output
```

The default region is `us-east-1`. This configuration creates the following resources.

| Resource | Purpose |
| --- | --- |
| Cognito user pool and public app client | Email registration, confirmation, sign-in and password reset |
| `itinerary-planner-users` | User profiles, keyed by `userId` |
| `Trip` | Trips, keyed by `userId` and `tripId` |
| `Stop` | Activities, keyed by `tripId` and `stopId` |
| `itinerary-planner-rate-limit` | Place request counters, keyed by `userId` and `window`, with `expiresAt` TTL |
| Location map and Esri place index | Browser map tiles and search |
| Local backend IAM policy | Access to these tables and the required Places v2 operations |

Terraform uses local state. State and plan files are gitignored and must remain private. Keep a secure backup so you can manage and remove your resources later. No credentials or state are supplied by this repository.

## 2. Give the backend access

Attach the policy named by `local_backend_policy_arn` to the role used by your development AWS profile. For an SSO profile, an account administrator can include it in the role's permission set. Terraform deliberately does not create permanent access keys or assign permissions to a person.

Use a separate provisioning profile if needed. The backend only needs the generated application policy, not administrator permissions. Its DynamoDB permissions are restricted to the four application tables. Places v2 actions use `Resource: "*"` because those operations do not support individual place resource ARNs.

Copy `backend/.env.example` to `backend/.env` and set your application profile. Fill in `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` from Terraform outputs. The example table names match the created tables.

## 3. Configure the browser

Copy `.env.example` to `.env.local`. Set `VITE_COGNITO_CLIENT_ID` to `cognito_client_id` and use the same region as the backend. Keep both API URLs as `http://localhost:3001`.

The generated Cognito client has **no client secret**, supports password sign-in and refresh tokens, and allows the email and name attributes used by the app. Passwords require at least 12 characters with uppercase, lowercase, a number and a symbol. Registration sends an email confirmation code. Cognito's default email delivery has sending limits, so configure your own delivery service before opening registration to a large audience.

### Maps and search

Create an Amazon Location API key in your AWS account using the console. Restrict it to the `location_map_arn` and `location_place_index_arn` outputs and these actions.

- `geo:GetMapStyleDescriptor`
- `geo:GetMapGlyphs`
- `geo:GetMapSprites`
- `geo:GetMapTile`
- `geo:SearchPlaceIndexForText`
- `geo:SearchPlaceIndexForSuggestions`

Set an expiry and the allowed referrer `http://localhost:5173/*`. Put the key in `VITE_AWS_LOCATION_API_KEY`, and use the map and index names from the outputs. If you choose another browser origin, the local server's CORS policy must also be updated deliberately.

Browser keys are visible to users. Referrer restrictions reduce casual misuse but are not authentication or a spending limit. Never substitute an AWS access key for a Location browser key.

The browser uses the Esri place index for search. The backend uses its AWS role to resolve saved details with Places v2 and `IntendedUse: Storage`. Keep the required provider attribution visible and follow Amazon Location's data terms.

### Optional travel estimates

Create a separate restricted key with `geo-routes:CalculateRoutes` on `arn:aws:geo-routes:us-east-1::provider/default`, with the same localhost referrer restriction and an expiry. Set `VITE_AWS_ROUTES_API_KEY`. Adjust the region in the ARN if you changed it and have confirmed service availability there.

Without this key, automatic ground-travel estimates are unavailable. Estimates use current conditions and are kept only for the browser session. They do not reorder the itinerary or draw a route line.

## 4. Start and verify

Follow the [local server commands](../README.md#run-locally). Register with an email address you can access and confirm the code. Create a trip, select a place and add an activity. Reload to check persistence, then edit and delete that test trip. Check maps and search, and travel estimates if configured.

If sign-in fails, check the app client ID and region. For backend 401 responses, check that both environment files identify the same Cognito client and that the backend pool ID is correct. For AWS access errors, check profile expiry, the selected account and the role's policy. For map errors, check key expiry, referrers, resource restrictions and region.

## Clean up

Stop both local servers and delete Location API keys you created separately. To delete the resources Terraform created, run `terraform -chdir=infra plan -destroy`, review the proposed deletion and then run `terraform -chdir=infra destroy`. This deletes the development accounts and itinerary data. Detach the generated IAM policy from your role first. Do not run these commands against resources you intend to keep.

## Hosting your own version

`backend/src/lambda.ts` remains available as a Lambda entry point, but this development setup does not provision hosting. A hosted version needs your own HTTPS frontend and API, a scoped Lambda execution role, the backend environment variables and an exact `FRONTEND_ORIGIN`. Configure any API Gateway JWT authoriser against your Cognito pool and client. Supply both frontend API URLs at build time. Do not expose the local development server to the internet.
