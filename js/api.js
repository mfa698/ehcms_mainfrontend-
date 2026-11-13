/* ==========================================================
   e-HCMS API LAYER
   This is the ONE place that talks to the backend.
   login.html and dashboard.html both use it.

   TO CONNECT THE REAL BACKEND, you will normally only change:
     1) API_CONFIG.USE_MOCK  -> false
     2) API_CONFIG.BASE_URL  -> the second group's server address
     3) API_CONFIG.ENDPOINTS -> their real paths
     4) mapLoginResponse / mapDashboardResponse (section 1 below)
        if their field names differ from the ones used here.
   ========================================================== */

var API_CONFIG = {
  // true  = DEMO MODE: no server needed, sample data is used.
  // false = REAL MODE: requests go to BASE_URL below.
  USE_MOCK: true,

  BASE_URL: "http://localhost:8000",

  ENDPOINTS: {
    login:     "/auth/login",          // POST  { username, password }
    dashboard: "/consul/dashboard"     // GET   (needs the login token)
  }
};

var SESSION_KEY = "ehcms_session";


/* ==========================================================
   1) ADAPTERS
   If the backend names things differently, fix it HERE and
   nothing else in the pages needs to change.

   What the pages expect from LOGIN:
     { token: "abc...", user: { name: "Jane Doe", role: "honorary_consul" } }

   What the dashboard expects from GET dashboard:
     {
       user:      { name: "Jane Doe", role: "honorary_consul" },
       mission:   "City, Country",
       contract:  { appointmentDate: "2024-01-15",
                    endDate: "2027-01-14",
                    daysRemaining: 72 },
       nextReport:   { quarter: "Q4 2026", dueDate: "2026-12-31" },
       submission:   { quarter: "Q3 2026",
                       status: "submitted" | "draft" | "not_started",
                       submittedAt: "2026-10-20" },
       unreadNotifications: 3,
       recentActivity: [
         { date: "2026-11-10", title: "Meeting with ...", status: "completed" | "ongoing" }
       ]
     }
   Dates are "YYYY-MM-DD" text. Share this list with the backend team.
   ========================================================== */
function mapLoginResponse(data) {
  return {
    token: data.token,
    user: { name: data.user.name, role: data.user.role }
  };
}

function mapDashboardResponse(data) {
  return data;   // change this if the backend's shape is different
}


/* ==========================================================
   2) SESSION (kept only while the browser tab is open)
   NOTE: when the backend team confirms how sessions work
   (token vs secure cookie), this is the part that may change.
   ========================================================== */
function saveSession(session) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
}

function getSession() {
  try {
    var raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}


/* ==========================================================
   3) REAL REQUESTS
   Errors have a .code you can check:
     "NETWORK" = server not reachable (or blocked by CORS)
     "AUTH"    = wrong details, or the login has expired
     "SERVER"  = the server answered with an error
   ========================================================== */
function apiRequest(method, path, body) {
  var session = getSession();
  var headers = { "Accept": "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (session && session.token) headers["Authorization"] = "Bearer " + session.token;

  return fetch(API_CONFIG.BASE_URL + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  })
    .catch(function () {
      var err = new Error("Server not reachable");
      err.code = "NETWORK";
      throw err;
    })
    .then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var authErr = new Error("Not authorised");
        authErr.code = "AUTH";
        authErr.status = res.status;
        throw authErr;
      }
      if (!res.ok) {
        var serverErr = new Error("Server error " + res.status);
        serverErr.code = "SERVER";
        serverErr.status = res.status;
        throw serverErr;
      }
      return res.json();
    });
}


/* ==========================================================
   4) DEMO DATA (used only when USE_MOCK is true)
   ========================================================== */
function daysFromNow(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function mockDashboard() {
  return {
    user: { name: "Demo Honorary Consul", role: "honorary_consul" },
    mission: "Demo City, Demo Country",
    contract: {
      appointmentDate: daysFromNow(-1020),
      endDate: daysFromNow(72),
      daysRemaining: 72
    },
    nextReport: { quarter: "Q4 2026", dueDate: daysFromNow(48) },
    submission: { quarter: "Q3 2026", status: "submitted", submittedAt: daysFromNow(-20) },
    unreadNotifications: 3,
    recentActivity: [
      { date: daysFromNow(-2),  title: "Met a local business delegation about trade links", status: "completed" },
      { date: daysFromNow(-6),  title: "Assisted a Kenyan citizen with a travel document query", status: "completed" },
      { date: daysFromNow(-11), title: "Preparing the Q4 community engagement event", status: "ongoing" },
      { date: daysFromNow(-19), title: "Quarterly report for Q3 submitted", status: "completed" }
    ]
  };
}


/* ==========================================================
   5) PUBLIC FUNCTIONS (what the pages call)
   ========================================================== */
var Api = {

  login: function (username, password) {
    if (API_CONFIG.USE_MOCK) {
      return wait(600).then(function () {
        var session = {
          token: "demo-token",
          user: { name: "Demo Honorary Consul", role: "honorary_consul" }
        };
        saveSession(session);
        return session;
      });
    }
    return apiRequest("POST", API_CONFIG.ENDPOINTS.login, {
      username: username,
      password: password
    })
      .then(mapLoginResponse)
      .then(function (session) {
        saveSession(session);
        return session;
      });
  },

  getDashboard: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(500).then(mockDashboard);
    }
    return apiRequest("GET", API_CONFIG.ENDPOINTS.dashboard)
      .then(mapDashboardResponse)
      .catch(function (err) {
        if (err.code === "AUTH") clearSession();   // login expired
        throw err;
      });
  },

  isLoggedIn: function () {
    var s = getSession();
    return !!(s && s.token);
  },

  getUser: function () {
    var s = getSession();
    return s ? s.user : null;
  },

  logout: function () {
    clearSession();
  }
};