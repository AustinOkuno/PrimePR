// Handoff between the UI and Person A's analysis.
// For now these return sample data; Person A swaps in the real versions.

function getGraph(owner, repo) {
  return MAP_DATA;
}

function traceFeature(owner, repo, question) {
  return {
    answer: "Login starts in the form, goes to the server, and checks the password against the database.",
    steps: [
      { file: "src/components/LoginForm.jsx", note: "The user types their email and password here." },
      { file: "src/utils/apiClient.js", note: "Sends the login request to the server." },
      { file: "src/api/routes.js", note: "The server sends /login to the login code." },
      { file: "src/auth/login.js", note: "Looks up the user and checks the password." },
      { file: "src/utils/hash.js", note: "Compares the password to the saved hash." },
      { file: "src/db/users.js", note: "Fetches the user record from the database." },
      { file: "src/auth/session.js", note: "Starts a session so the user stays logged in." },
    ],
  };
}
