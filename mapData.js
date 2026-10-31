// Sample map in the same shape as buildGraph() in graph.js.
// Swap in Person A's real output for the demo repo when it's ready.
const MAP_DATA = {
  "nodes": [
    {
      "id": "src/index.js",
      "group": "src",
      "role": "entry",
      "summary": "Starts the app: loads settings and boots the server.",
      "importance": 6,
      "imports": [
        "src/server.js",
        "src/config.js"
      ],
      "importedBy": []
    },
    {
      "id": "src/server.js",
      "group": "src",
      "role": "entry",
      "summary": "Creates the web server, plugs in middleware and routes, and connects to the database.",
      "importance": 6,
      "imports": [
        "src/api/routes.js",
        "src/api/middleware.js",
        "src/db/connection.js",
        "src/config.js"
      ],
      "importedBy": [
        "src/index.js"
      ]
    },
    {
      "id": "src/config.js",
      "group": "src",
      "role": "config",
      "summary": "Holds settings like the database URL, port, and session secret.",
      "importance": 10,
      "imports": [],
      "importedBy": [
        "src/index.js",
        "src/server.js",
        "src/auth/session.js",
        "src/db/connection.js"
      ]
    },
    {
      "id": "src/api/routes.js",
      "group": "api",
      "role": "logic",
      "summary": "Maps each URL (like /login or /posts) to the code that handles it.",
      "importance": 5,
      "imports": [
        "src/auth/login.js",
        "src/auth/signup.js",
        "src/db/posts.js",
        "src/api/middleware.js"
      ],
      "importedBy": [
        "src/server.js"
      ]
    },
    {
      "id": "src/api/middleware.js",
      "group": "api",
      "role": "logic",
      "summary": "Runs before every request: checks if the user is logged in.",
      "importance": 6,
      "imports": [
        "src/auth/session.js"
      ],
      "importedBy": [
        "src/server.js",
        "src/api/routes.js"
      ]
    },
    {
      "id": "src/auth/login.js",
      "group": "auth",
      "role": "logic",
      "summary": "Checks a user's email and password, then starts a session.",
      "importance": 4,
      "imports": [
        "src/db/users.js",
        "src/auth/session.js",
        "src/utils/hash.js"
      ],
      "importedBy": [
        "src/api/routes.js"
      ]
    },
    {
      "id": "src/auth/signup.js",
      "group": "auth",
      "role": "logic",
      "summary": "Creates a new account after validating the email and password.",
      "importance": 4,
      "imports": [
        "src/db/users.js",
        "src/utils/hash.js"
      ],
      "importedBy": [
        "src/api/routes.js"
      ]
    },
    {
      "id": "src/auth/session.js",
      "group": "auth",
      "role": "logic",
      "summary": "Creates, reads, and ends login sessions using a signed cookie.",
      "importance": 6,
      "imports": [
        "src/config.js"
      ],
      "importedBy": [
        "src/api/middleware.js",
        "src/auth/login.js"
      ]
    },
    {
      "id": "src/db/connection.js",
      "group": "db",
      "role": "data",
      "summary": "Opens the single shared connection to the database.",
      "importance": 8,
      "imports": [
        "src/config.js"
      ],
      "importedBy": [
        "src/server.js",
        "src/db/users.js",
        "src/db/posts.js"
      ]
    },
    {
      "id": "src/db/users.js",
      "group": "db",
      "role": "data",
      "summary": "Reads and saves user records (email, password hash, name).",
      "importance": 6,
      "imports": [
        "src/db/connection.js"
      ],
      "importedBy": [
        "src/auth/login.js",
        "src/auth/signup.js"
      ]
    },
    {
      "id": "src/db/posts.js",
      "group": "db",
      "role": "data",
      "summary": "Reads and saves posts for the feed.",
      "importance": 3,
      "imports": [
        "src/db/connection.js"
      ],
      "importedBy": [
        "src/api/routes.js"
      ]
    },
    {
      "id": "src/components/App.jsx",
      "group": "components",
      "role": "ui",
      "summary": "The top-level screen: shows the login form or the feed.",
      "importance": 1,
      "imports": [
        "src/components/LoginForm.jsx",
        "src/components/Feed.jsx"
      ],
      "importedBy": []
    },
    {
      "id": "src/components/LoginForm.jsx",
      "group": "components",
      "role": "ui",
      "summary": "The email and password form the user fills in to log in.",
      "importance": 3,
      "imports": [
        "src/utils/apiClient.js"
      ],
      "importedBy": [
        "src/components/App.jsx"
      ]
    },
    {
      "id": "src/components/Feed.jsx",
      "group": "components",
      "role": "ui",
      "summary": "Loads the latest posts and shows them as a list.",
      "importance": 4,
      "imports": [
        "src/components/PostCard.jsx",
        "src/utils/apiClient.js"
      ],
      "importedBy": [
        "src/components/App.jsx"
      ]
    },
    {
      "id": "src/components/PostCard.jsx",
      "group": "components",
      "role": "ui",
      "summary": "Shows one post: author, text, and time.",
      "importance": 3,
      "imports": [],
      "importedBy": [
        "src/components/Feed.jsx"
      ]
    },
    {
      "id": "src/utils/apiClient.js",
      "group": "utils",
      "role": "util",
      "summary": "Sends requests from the browser to the server's API.",
      "importance": 5,
      "imports": [],
      "importedBy": [
        "src/components/LoginForm.jsx",
        "src/components/Feed.jsx"
      ]
    },
    {
      "id": "src/utils/hash.js",
      "group": "utils",
      "role": "util",
      "summary": "Hashes and checks passwords so they're never stored as plain text.",
      "importance": 5,
      "imports": [],
      "importedBy": [
        "src/auth/login.js",
        "src/auth/signup.js"
      ]
    }
  ],
  "edges": [
    {
      "from": "src/index.js",
      "to": "src/server.js"
    },
    {
      "from": "src/index.js",
      "to": "src/config.js"
    },
    {
      "from": "src/server.js",
      "to": "src/api/routes.js"
    },
    {
      "from": "src/server.js",
      "to": "src/api/middleware.js"
    },
    {
      "from": "src/server.js",
      "to": "src/db/connection.js"
    },
    {
      "from": "src/server.js",
      "to": "src/config.js"
    },
    {
      "from": "src/api/routes.js",
      "to": "src/auth/login.js"
    },
    {
      "from": "src/api/routes.js",
      "to": "src/auth/signup.js"
    },
    {
      "from": "src/api/routes.js",
      "to": "src/db/posts.js"
    },
    {
      "from": "src/api/routes.js",
      "to": "src/api/middleware.js"
    },
    {
      "from": "src/api/middleware.js",
      "to": "src/auth/session.js"
    },
    {
      "from": "src/auth/login.js",
      "to": "src/db/users.js"
    },
    {
      "from": "src/auth/login.js",
      "to": "src/auth/session.js"
    },
    {
      "from": "src/auth/login.js",
      "to": "src/utils/hash.js"
    },
    {
      "from": "src/auth/signup.js",
      "to": "src/db/users.js"
    },
    {
      "from": "src/auth/signup.js",
      "to": "src/utils/hash.js"
    },
    {
      "from": "src/auth/session.js",
      "to": "src/config.js"
    },
    {
      "from": "src/db/connection.js",
      "to": "src/config.js"
    },
    {
      "from": "src/db/users.js",
      "to": "src/db/connection.js"
    },
    {
      "from": "src/db/posts.js",
      "to": "src/db/connection.js"
    },
    {
      "from": "src/components/App.jsx",
      "to": "src/components/LoginForm.jsx"
    },
    {
      "from": "src/components/App.jsx",
      "to": "src/components/Feed.jsx"
    },
    {
      "from": "src/components/LoginForm.jsx",
      "to": "src/utils/apiClient.js"
    },
    {
      "from": "src/components/Feed.jsx",
      "to": "src/components/PostCard.jsx"
    },
    {
      "from": "src/components/Feed.jsx",
      "to": "src/utils/apiClient.js"
    }
  ],
  "neighborhoods": [
    {
      "name": "src",
      "summary": "App startup and settings.",
      "files": [
        "src/index.js",
        "src/server.js",
        "src/config.js"
      ]
    },
    {
      "name": "api",
      "summary": "The server's front door: URLs and request checks.",
      "files": [
        "src/api/routes.js",
        "src/api/middleware.js"
      ]
    },
    {
      "name": "auth",
      "summary": "Logging in, signing up, and sessions.",
      "files": [
        "src/auth/login.js",
        "src/auth/signup.js",
        "src/auth/session.js"
      ]
    },
    {
      "name": "db",
      "summary": "Everything that talks to the database.",
      "files": [
        "src/db/connection.js",
        "src/db/users.js",
        "src/db/posts.js"
      ]
    },
    {
      "name": "components",
      "summary": "The screens and pieces the user sees.",
      "files": [
        "src/components/App.jsx",
        "src/components/LoginForm.jsx",
        "src/components/Feed.jsx",
        "src/components/PostCard.jsx"
      ]
    },
    {
      "name": "utils",
      "summary": "Small shared helpers.",
      "files": [
        "src/utils/apiClient.js",
        "src/utils/hash.js"
      ]
    }
  ]
};
