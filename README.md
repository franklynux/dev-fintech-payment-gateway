# Fintech-Payment-Gateway-Proxy

## Specification

# Add Security Scanning Hooks to Project Repos 

# Security Scans Workflow (Trivy)

This project includes a GitHub Actions workflow for automated security scanning using **Trivy**. The workflow is triggered automatically on every **push** and **pull request** to any branch.

## Workflow Overview
### The workflow is configured in yaml 

The workflow performs multiple types of security scans to ensure the repository and its configuration are safe from vulnerabilities and misconfigurations. The main steps are:

1. **Checkout Repository**  
   The workflow starts by checking out the repository code using `actions/checkout@v4`.

2. **Install Trivy**  
   Trivy is installed on the runner using the official Aquasecurity repository. Required dependencies (`wget`, `apt-transport-https`, etc.) are installed to enable Trivy installation.

3. **Cache Trivy Database**  
   Trivy downloads a vulnerability database to detect security issues. The workflow caches this database (`~/.cache/trivy`) between runs to speed up subsequent scans.

4. **Secret Scanning**  
   Trivy scans the filesystem (`trivy fs`) for **secrets** such as API keys or credentials, focusing on **high** and **critical** severity. If any issues are found, the workflow fails with `--exit-code 1`.

5. **Vulnerability Scanning**  
   The workflow scans for **high and critical vulnerabilities** in dependencies, container images, and configuration files. Detected issues will fail the workflow, ensuring that vulnerabilities are caught early.

6. **Misconfiguration (PCI) Scanning**  
   Trivy also checks for **misconfigurations** in Dockerfiles, Kubernetes manifests, Terraform scripts, CloudFormation templates, YAML, and JSON files. Custom policies from the `./policies` directory are applied, with medium and higher severity issues causing the workflow to fail.

## Environment

- Runs on `ubuntu-latest` GitHub Actions runner.
- Uses `TRIVY_CACHE_DIR` to store the vulnerability database locally.

## Outcome

- If any secrets, vulnerabilities, or misconfigurations are detected at the configured severity levels, the workflow fails and prevents merging until issues are addressed.
- This ensures that code merged into the repository meets security standards and reduces the risk of introducing vulnerabilities.


[Tech Spec](SPEC.md)
