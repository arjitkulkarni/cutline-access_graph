# Optional: Open Policy Agent as the independent enforcement engine (AUTHZ_ENGINE=opa), as a second
# Railway service with root directory "backend/policies". The API reaches it over private networking:
#   OPA_URL=http://<opa-service-name>.railway.internal:8181
# ":8181" listens on IPv4 and IPv6. Local Docker Compose mounts this folder instead of using this image.
FROM openpolicyagent/opa:1.21.2
COPY cutline_authz.rego /policies/cutline_authz.rego
EXPOSE 8181
CMD ["run", "--server", "--addr", ":8181", "--set", "decision_logs.console=true", "/policies/cutline_authz.rego"]
