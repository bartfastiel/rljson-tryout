#!/usr/bin/env bash
set -euo pipefail

# Posts or updates the one comment that tells a pull request where its
# preview environment is. The comment carries a hidden HTML marker; every
# later run finds the previous comment by that marker and edits it in
# place, so a pull request never collects one comment per push.
#   GITHUB_REPOSITORY    owner/name of the repository
#   PULL_REQUEST_NUMBER  the pull request to comment on
#   PREVIEW_STATUS       deployed: creates the comment or updates it;
#                        destroyed: updates an existing comment, never creates one
#   DEPLOYMENT_URLS      space separated https base URLs, required when deployed
#   DEPLOYED_COMMIT      the commit /health reports, required when deployed
# gh authenticates with GH_TOKEN; nothing secret enters the comment.

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must name the repository as owner/name}"
: "${PULL_REQUEST_NUMBER:?PULL_REQUEST_NUMBER must name the pull request}"
: "${PREVIEW_STATUS:?PREVIEW_STATUS must be deployed or destroyed}"

fail() {
  echo "::error::$*"
  exit 1
}

marker="<!-- rljson-tryout-preview -->"
namespace="pr-${PULL_REQUEST_NUMBER}"

case "${PREVIEW_STATUS}" in
  deployed)
    : "${DEPLOYMENT_URLS:?DEPLOYMENT_URLS must list the https base URLs of the preview}"
    : "${DEPLOYED_COMMIT:?DEPLOYED_COMMIT must name the commit the preview serves}"
    # shellcheck disable=SC2206 # the variable is a space separated list by contract
    urls=(${DEPLOYMENT_URLS})
    if [ "${#urls[@]}" -eq 0 ]; then
      fail "DEPLOYMENT_URLS holds no URL"
    fi
    body="${marker}"$'\n'
    body+="## Preview environment"$'\n\n'
    body+="Commit \`${DEPLOYED_COMMIT}\` (the merge of this pull request into \`main\` that the pipeline built and tested) runs in namespace \`${namespace}\`:"$'\n\n'
    for url in "${urls[@]}"; do
      body+="- ${url}/ ([health](${url}/health), [species](${url}/api/species))"$'\n'
    done
    body+=$'\n'
    body+="The certificate comes from the Let's Encrypt **staging** issuer: the browser shows a warning once per preview, accept it to continue (\`curl -k\` on the command line). Previews stay on staging so that they never use up the 50 certificates per week that production's hosts share. The environment is destroyed when this pull request is closed."$'\n'
    ;;
  destroyed)
    body="${marker}"$'\n'
    body+="## Preview environment"$'\n\n'
    body+="Destroyed after the pull request was closed: namespace \`${namespace}\` and its Terraform workspace are gone. Reopening the pull request runs the pipeline again, which recreates them."$'\n'
    ;;
  *)
    fail "PREVIEW_STATUS must be deployed or destroyed, got: ${PREVIEW_STATUS}"
    ;;
esac

comments_path="repos/${GITHUB_REPOSITORY}/issues/${PULL_REQUEST_NUMBER}/comments"
comment_ids="$(gh api "${comments_path}" --paginate --jq ".[] | select(.body | contains(\"${marker}\")) | .id")"
comment_id="${comment_ids%%$'\n'*}"
payload="$(jq -n --arg body "${body}" '{ body: $body }')"

if [ -n "${comment_id}" ]; then
  comment_url="$(printf '%s' "${payload}" | gh api --method PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${comment_id}" --input - --jq .html_url)"
  echo "Updated the preview comment: ${comment_url}"
elif [ "${PREVIEW_STATUS}" = deployed ]; then
  comment_url="$(printf '%s' "${payload}" | gh api --method POST "${comments_path}" --input - --jq .html_url)"
  echo "Created the preview comment: ${comment_url}"
else
  echo "Pull request ${PULL_REQUEST_NUMBER} has no preview comment; nothing to update."
fi
