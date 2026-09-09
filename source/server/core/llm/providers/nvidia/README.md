# NVIDIA Provider

Configure a [NVIDIA Build API key](https://build.nvidia.com/settings/api-key)
in Lemo's provider settings. Configuration and activation follow the same
contract as the other Providers. Keys stay in the Server's Program store;
Client state exposes only configuration and activation status.

## Discovery

Available Models come from NVIDIA's `/v1/models`. Capabilities come from the
NVIDIA entries in [Models.dev](https://models.dev). Discovery requires a Model
to appear in both sources with declared Tool support and text input/output.
This excludes embeddings and other non-agent Models without guessing from IDs.
Models missing from the capability catalog are not listed.

Context windows and effort choices come from that catalog. Missing context
limits remain unknown. Only declared effort values understood by the API are
exposed; reasoning toggles without an effort mapping use Provider defaults.

## Generation

The Provider uses the OpenAI SDK against
[NVIDIA's hosted chat API](https://docs.api.nvidia.com/nim/reference/llm-apis),
not OpenAI's service. It adapts streaming text, Tool calls, cancellation, and
reported token usage to the existing LLM Model contract. Missing usage remains
unknown. Failed requests are not automatically retried. Incomplete generations
and malformed Tool calls fail without executing partial calls.

## Verification

The repository's `verify` command includes the offline Provider checks.
For an explicit live Tool round trip, provide `NVIDIA_API_KEY` in the environment
and run `bun run verify:nvidia:live`. It sends two small requests and reports
usage without persisting the key. `NVIDIA_TEST_MODEL` overrides the test Model.
