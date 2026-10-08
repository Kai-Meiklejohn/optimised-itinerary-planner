# Optimised Itinerary Planner

A travel planner built with React and TypeScript. Create trips, organise daily activities, find places on a map and estimate travel times. Automatic itinerary optimisation is not included.

**This is a later public release of a group project, not the original repository we developed it in.** The original collaboration history is kept separately in a private archive, so this repository’s commit history does not represent everyone’s contributions.

The original hosted service has been retired. There is no public demo or shared AWS account. You can run this version locally with your own AWS resources or follow the [hosting guide](docs/hosting.md) to deploy it yourself.

## Screenshots

These screenshots show the original application with an example itinerary. Running your own version requires the AWS setup below.

### Sign in

Sign in to your account, register as a new user or reset a forgotten password.

![Sign-in screen with email and password fields](docs/screenshots/sign-in.png)

### Trip dashboard

View your saved itineraries and their dates, open an existing trip or create a new one.

![Trip dashboard showing a New Zealand holiday itinerary](docs/screenshots/dashboard.png)

### Daily planner

Switch between days, add or edit activities and organise their times, categories and notes. Numbered map pins show saved places, with optional travel-time estimates between stops.

![Daily itinerary with scheduled Auckland activities, travel estimates and numbered map pins](docs/screenshots/daily-planner.png)

## Set up your own copy

Choose local development first to check your AWS configuration. To put the app online afterwards, follow [Deploy on AWS](docs/hosting.md), which covers the backend, HTTPS frontend, permissions and release checks. GitHub Actions only runs tests and validation. It does not deploy your copy.

### 1. Install the tools and code

You need Git, Node.js 24 LTS, npm, AWS CLI v2 and Terraform 1.15 or newer. The commands below use a Bash-compatible terminal. Tests and builds work without AWS, but sign-in, saved trips and maps need your own AWS account even when the servers run locally.

```bash
git clone https://github.com/Kai-Meiklejohn/optimised-itinerary-planner.git
cd optimised-itinerary-planner
npm ci
npm ci --prefix backend
cp .env.example .env.local
cp backend/.env.example backend/.env
```

### 2. Create your AWS resources

Use a development account and set a billing alert first. Configure a named AWS profile with permission to create the resources described in the [AWS setup guide](infra/README.md). If your account uses IAM Identity Center, configure temporary credentials like this.

```bash
aws configure sso --profile itinerary-dev
aws sso login --profile itinerary-dev
export AWS_PROFILE=itinerary-dev
aws sts get-caller-identity
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
terraform -chdir=infra output
```

Check the account shown by `get-caller-identity` and review the Terraform plan before approving it. Terraform creates a Cognito user pool, a public app client, four DynamoDB tables, a Location map and place index, and a backend access policy. It does not create AWS login credentials or host the application. Keep Terraform state private and backed up.

Attach the policy shown by `local_backend_policy_arn` to the role used by your backend profile, as explained in [backend permissions](infra/README.md#2-give-the-backend-access). Provisioning resources requires broader permissions than running the app, so use a separate provisioning profile if necessary.

### 3. Fill in the environment files

Use `terraform -chdir=infra output -raw OUTPUT_NAME` to copy a single value from this table.

| Terraform output | Frontend `.env.local` | Backend `backend/.env` |
| --- | --- | --- |
| `aws_region` | `VITE_AWS_REGION` | `AWS_REGION` |
| `cognito_client_id` | `VITE_COGNITO_CLIENT_ID` | `COGNITO_CLIENT_ID` |
| `cognito_user_pool_id` | Not needed | `COGNITO_USER_POOL_ID` |
| `users_table_name` | Not needed | `USER_TABLE_NAME` |
| `trips_table_name` | Not needed | `TRIP_TABLE_NAME` |
| `stops_table_name` | Not needed | `STOP_TABLE_NAME` |
| `rate_limit_table_name` | Not needed | `RATE_LIMIT_TABLE_NAME` |
| `location_map_name` | `VITE_LOCATION_MAP_NAME` | Not needed |
| `location_place_index_name` | `VITE_LOCATION_PLACE_INDEX_NAME` | Not needed |

Set `AWS_PROFILE` in `backend/.env` to your application profile. Keep both `VITE_API_BASE_URL` and `VITE_BACKEND_API_URL` set to `http://localhost:3001` for local development. Both files must use the same Cognito client and region.

Create a restricted Amazon Location browser key using the [map and search instructions](infra/README.md#maps-and-search), then put it in `VITE_AWS_LOCATION_API_KEY`. Travel estimates use a separate optional key in `VITE_AWS_ROUTES_API_KEY`. The guide lists the exact actions, resource restrictions and allowed referrer to use.

Never put AWS access keys or private credentials in a `VITE_` variable. Those values are included in the browser bundle. Both environment files are gitignored.

### 4. Start and check the app

Start the frontend in one terminal.

```bash
npm run dev
```

Start the backend from the repository root in another terminal.

```bash
npm run dev --prefix backend
```

Open **http://localhost:5173**, register with an email address you can access, confirm the emailed code and sign in. New passwords need at least 12 characters with uppercase, lowercase, a number and a symbol. Create a trip, add a place and reload to check that it was saved. Check editing and deletion too.

The backend listens on `127.0.0.1:3001` and allows the frontend origin `http://localhost:5173`. Use that exact browser address. Restart both servers after changing environment files. If something fails, see [troubleshooting](infra/README.md#troubleshooting).

## Checks

```bash
npm run lint
npm test
npm run build
npm run typecheck --prefix backend
npm test --prefix backend
npm run build --prefix backend
```

Tests use mocked services and do not contact AWS. GitHub Actions runs these checks and validates Terraform without cloud credentials. It does not deploy anything.

## How it works

The React frontend uses Cognito for accounts and Amazon Location for maps, search and optional travel estimates. The local Node.js backend verifies the user's token, checks trip ownership and saves data to DynamoDB. Saved place details are resolved through Amazon Location Places v2. MapLibre renders the map in the browser.

The backend also includes a Lambda handler for developers who want to build their own hosted deployment. The retired hosting configuration and automatic deployment workflows are not included. You must configure authentication, HTTPS and service permissions for any deployment you create.

## Documentation

- [AWS resources and configuration](infra/README.md)
- [Deploy on AWS](docs/hosting.md)
- [Activity editing and scheduling](docs/activity-editing.md)
- [Security and reporting vulnerabilities](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Contributors

The original application was a team effort. Credit goes to all five contributors, regardless of the shorter history in this public release.

- **Kai Meiklejohn** — [@Kai-Meiklejohn](https://github.com/Kai-Meiklejohn)
- **Ashtar** — [@AshCash223](https://github.com/AshCash223)
- **Riley Cooney** — [@coonamatata](https://github.com/coonamatata)
- **Phuoc** — [@PhuocDoHuu](https://github.com/PhuocDoHuu)
- **Chathurangi** — [@NilushikaSandeepani](https://github.com/NilushikaSandeepani)

## Licence

[MIT](LICENSE). Third-party packages and Amazon Location data retain their own licences and terms.
