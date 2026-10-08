# Security

The original hosted environment has been retired. This repository contains no supported public service or shared credentials. A deployment you create is your responsibility.

## Configuration

- Keep AWS credentials in your credential provider or AWS profile, outside the repository. Prefer temporary credentials and narrowly scoped roles.
- Never commit `.env` files, live browser keys, private keys, Terraform state or saved plans. Example files contain placeholders only.
- Every `VITE_` variable is public in the browser bundle. Amazon Location browser keys must have restricted actions, resources, referrers and an expiry.
- Keep backend token verification and ownership checks enabled. The local server binds to loopback and is only intended for development.
- Use HTTPS for a hosted application and its API. Review permissions, data retention, monitoring and spending controls before making a deployment public.

GitHub Actions runs without AWS credentials and does not deploy infrastructure. Dependency updates and secret checks help catch mistakes, but cannot guarantee the absence of vulnerabilities.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option for private reports. Include the affected version and steps to reproduce. Do not place credentials, personal data or exploit details in a public issue. If you accidentally disclose a credential, revoke it with its provider immediately before cleaning up the published copy.
