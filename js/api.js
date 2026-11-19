/* ==========================================================
   e-HCMS API LAYER
   This is the ONE place that talks to the backend.
   Every page uses it.

   TO CONNECT THE REAL BACKEND, you will normally only change:
     1) API_CONFIG.USE_MOCK  -> false
     2) API_CONFIG.BASE_URL  -> the second group's server address
     3) API_CONFIG.ENDPOINTS -> their real paths
     4) the "map" functions in section 1 if their field names differ.
   ========================================================== */

var API_CONFIG = {
  // true  = DEMO MODE: no server needed, sample data is used.
  // false = REAL MODE: requests go to BASE_URL below.
  USE_MOCK: false,

  BASE_URL: "http://127.0.0.1:8000",

  // Users log in with a Work ID and a password.
  // This is the NAME of the field the backend expects the Work ID in
  // (for example "workId", "work_id" or "username"). Change it to match their login API.
  LOGIN_ID_FIELD: "work_id",

  ENDPOINTS: {
    login:         "/api/auth/login/",        // POST { work_id, password }
    verifyOtp:     "/api/auth/verify-otp/",   // POST { challenge_id, otp_code }
    changePassword: "/api/auth/change-password/",
    dashboard:     "/consul/dashboard",  // GET
    profile:       "/consul/profile",         // GET, PUT { email, phone, officeAddress }
    notifications: "/consul/notifications",   // GET; POST /{id}/read; POST /read-all
    workLog:       "/consul/work-log",        // GET; POST (form data); PATCH /{id} { status }
    reports:       "/consul/reports",         // GET; PUT /{id}/draft; POST /{id}/submit (form data)

    // Head of Mission portal
    homDashboard:     "/api/dashboard/ambassador/", // GET (backend role: ambassador)
    homConsuls:       "/hom/consuls",         // GET (only the consuls assigned to this Head of Mission)
    homReports:       "/hom/reports",         // GET; POST /{id}/review { comment }
    homNotifications: "/hom/notifications",   // GET; POST /{id}/read; POST /read-all
    homPerformance:   "/hom/performance",     // GET
    homEvaluations:   "/hom/evaluations",     // POST { consulId, quarter, rating, comment }
    homRecommendations: "/hom/recommendations" // GET; POST { consulId, recommendation, justification }
  }
};

// Where each role lands after login. Role names must match what the backend sends
// (use mapLoginResponse below to translate if theirs are different).
var ROLE_HOMES = {
  honorary_consul: "dashboard.html",
  head_of_mission: "hom-dashboard.html"
  // hq_admin: "hq-dashboard.html"      (added when the HQ portal is built)
};

var SESSION_KEY = "ehcms_session";
var MOCK_KEY    = "ehcms_mock";


/* ==========================================================
   1) ADAPTERS + EXPECTED DATA SHAPES
   Share this with the backend team. Dates are "YYYY-MM-DD".

   LOGIN returns:
     { token: "abc...", user: { name: "Jane Doe", role: "honorary_consul" } }

   DASHBOARD returns:
     { user, mission, contract: { appointmentDate, endDate, daysRemaining },
       nextReport: { quarter, dueDate },
       submission: { quarter, status: "submitted"|"draft"|"not_started", submittedAt },
       unreadNotifications: 3,
       recentActivity: [ { date, title, status: "completed"|"ongoing" } ] }

   PROFILE returns:
     { fullName, title, mission, jurisdictions: ["City", "Region"],
       headOfMission, appointmentDate, contractEndDate,
       email, phone, officeAddress }

   NOTIFICATIONS returns a list:
     [ { id, title, message, date, type: "expiry"|"report"|"workflow", read: true|false } ]

   WORK LOG returns a list:
     [ { id, date, title, notes, status: "ongoing"|"completed",
         attachments: ["file.pdf"], locked: true|false } ]
     (locked = true when the entry belongs to an already submitted quarter)
     POST sends form data: date, title, notes, status, and files named "attachments".
     Allowed files: pdf, png, jpg, jpeg, docx. Max 5 MB each, max 5 files.

   REPORTS returns a list:
     [ { id, quarter: "Q3 2026", dueDate, status: "not_started"|"draft"|"submitted",
         submittedAt, reference,
         content: { summary, achievements, challenges, plans, attachments: ["file.pdf"] } } ]
     PUT  /{id}/draft   sends JSON { summary, achievements, challenges, plans }
     POST /{id}/submit  sends form data: summary, achievements, challenges, plans,
                        and files named "attachments". Returns the submitted report
                        (with reference and submittedAt).

   ----- HEAD OF MISSION -----
   Role value sent at login: "head_of_mission"

   HOM DASHBOARD returns:
     { user: { name, role }, mission: "Mission name",
       totals: { consuls, attention, pendingReports, expiring },
       attentionList: [ { id, name, city, reasons: ["Contract ends in 25 days"] } ],
       expiringList:  [ { id, name, endDate, daysRemaining } ],
       activity: { active, total, windowDays },
       unreadNotifications }

   HOM CONSULS returns a list (only consuls assigned to this Head of Mission):
     [ { id, name, city, email, phone, appointmentDate, contractEndDate, daysRemaining,
         lastActivity, entriesThisQuarter,
         reportStatus: "submitted"|"draft"|"not_started"|"overdue",
         attentionReasons: [ "Contract ends in 25 days" ] } ]

   HOM REPORTS returns a list (reports submitted by the assigned consuls):
     [ { id, consulId, consulName, quarter, submittedAt, reference,
         status: "pending_review"|"reviewed", reviewedAt, comment,
         content: { summary, achievements, challenges, plans, attachments: [] } } ]
     POST /{id}/review sends JSON { comment } and marks the report as reviewed.

   HOM NOTIFICATIONS use the same shape as the Consul notifications.

   HOM PERFORMANCE returns a list (one item per assigned consul):
     [ { consulId, name, city,
         metrics: { reportsOnTime, reportsTotal, avgEntriesPerQuarter, lastActivity },
         quarters: [ { quarter: "Q3 2026", entries: 8,
                       reportStatus: "submitted"|"late"|"missing"|"open" } ],   (newest first)
         evaluations: [ { id, quarter, rating: "excellent"|"good"|"satisfactory"|"needs_improvement",
                          comment, date } ] } ]
     POST /hom/evaluations sends JSON { consulId, quarter, rating, comment }.
     One evaluation per consul per quarter. A second one should be answered with 409.

   HOM RECOMMENDATIONS returns:
     { needed:    [ { consulId, name, city, contractEndDate, daysRemaining, latestRating } ],
       submitted: [ { id, consulId, consulName, recommendation:
                        "renew"|"renew_conditions"|"do_not_renew"|"further_review",
                      justification, submittedAt,
                      status: "submitted"|"approved"|"declined", hqNote } ] }
     "needed" = consuls whose contract ends soon and who have no recommendation waiting at HQ.
     POST /hom/recommendations sends JSON { consulId, recommendation, justification }.

   When an action is not allowed because the quarter is submitted, the server should
   answer with status 409 (or 423). The pages show a friendly "locked" message.
   ========================================================== */
function mapLoginResponse(data) {
  var backendRole = data.user.role;
      var role = backendRole === "consul" ? "honorary_consul"
        : backendRole === "ambassador" ? "head_of_mission" : backendRole;
  return {
    token: data.access,
    refresh: data.refresh,
    user: {
      id: data.user.id,
      workId: data.user.work_id,
      name: data.user.full_name,
      email: data.user.email,
      phone: data.user.phone_number,
      role: role
    }
  };
}

function mapDashboardResponse(data)     { return data; }
function mapProfileResponse(data)       { return data; }
function mapNotificationsResponse(data) { return data; }
function mapWorkLogResponse(data)       { return data; }
function mapReportsResponse(data)       { return data; }
function mapHomDashboardResponse(data)  { return data; }
function mapHomConsulsResponse(data)    { return data; }
function mapHomReportsResponse(data)    { return data; }
function mapHomPerformanceResponse(data) { return data; }
function mapHomRecommendationsResponse(data) { return data; }


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
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(MOCK_KEY);      // demo data resets on log out
  } catch (e) {}
}


/* ==========================================================
   3) REAL REQUESTS
   Errors have a .code you can check:
     "NETWORK" = server not reachable (or blocked by CORS)
     "AUTH"    = wrong details, or the login has expired
     "LOCKED"  = the record is locked (submitted quarter)
     "SERVER"  = the server answered with an error
   ========================================================== */
function makeError(code, text, status) {
  var err = new Error(text);
  err.code = code;
  if (status) err.status = status;
  return err;
}

function apiRequest(method, path, body) {
  var session = getSession();
  var headers = { "Accept": "application/json" };
  var isForm = (typeof FormData !== "undefined") && body instanceof FormData;

  // Form data (files) sets its own content type, JSON needs it spelled out
  if (body && !isForm) headers["Content-Type"] = "application/json";
  if (session && session.token) headers["Authorization"] = "Bearer " + session.token;

  return fetch(API_CONFIG.BASE_URL + path, {
    method: method,
    headers: headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined
  })
    .catch(function () {
      throw makeError("NETWORK", "Server not reachable");
    })
    .then(function (res) {
      if (res.status === 401 || res.status === 403) throw makeError("AUTH", "Not authorised", res.status);
      if (res.status === 409 || res.status === 423) throw makeError("LOCKED", "Record is locked", res.status);
      if (res.status === 204) return null;
      return res.json().then(function (data) {
        if (!res.ok) {
          var detail = data.error || data.detail || data.otp_code || data.new_password ||
            data.confirm_password || data.current_password || data.non_field_errors;
          if (Array.isArray(detail)) detail = detail.join(" ");
          throw makeError("SERVER", detail || ("Server error " + res.status), res.status);
        }
        return data;
      });
    });
}

// If any call says the login has expired, forget the session
function guardAuth(promise) {
  return promise.catch(function (err) {
    if (err && err.code === "AUTH") clearSession();
    throw err;
  });
}

// Builds form data for requests that carry files
function buildForm(fields, files) {
  var form = new FormData();
  Object.keys(fields).forEach(function (key) { form.append(key, fields[key] == null ? "" : fields[key]); });
  (files || []).forEach(function (file) { form.append("attachments", file); });
  return form;
}


/* ==========================================================
   4) DEMO DATA (used only when USE_MOCK is true)
   Kept in the browser tab, so changes you make (reading a
   notification, adding a work log entry, submitting a report)
   show on every page until you log out.
   ========================================================== */
function pad2(n) { return (n < 10 ? "0" : "") + n; }

function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

function todayText() { return ymd(new Date()); }

function daysFromNow(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function daysBetweenToday(text) {
  var target = new Date(text + "T00:00:00");
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function prettyDate(text) {
  return new Date(text + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* ----- quarters: "Q4 2026" ----- */
function quarterOf(text) {
  var d = new Date(text + "T00:00:00");
  return "Q" + (Math.floor(d.getMonth() / 3) + 1) + " " + d.getFullYear();
}

function quarterParts(label) {
  return { q: parseInt(label.charAt(1), 10), y: parseInt(label.slice(3), 10) };
}

function quarterEnd(label) {
  var p = quarterParts(label);
  return ymd(new Date(p.y, p.q * 3, 0));       // last day of the quarter
}

function nextQuarter(label) {
  var p = quarterParts(label);
  return p.q === 4 ? "Q1 " + (p.y + 1) : "Q" + (p.q + 1) + " " + p.y;
}

function prevQuarter(label) {
  var p = quarterParts(label);
  return p.q === 1 ? "Q4 " + (p.y - 1) : "Q" + (p.q - 1) + " " + p.y;
}

function reportId(label) { return "rep-" + label.replace(" ", "-"); }

function referenceFor(label, n) {
  var p = quarterParts(label);
  return "EHCMS-" + p.y + "-Q" + p.q + "-" + ("0000" + n).slice(-4);
}

function emptyContent() {
  return { summary: "", achievements: "", challenges: "", plans: "", attachments: [] };
}

function freshMockStore() {
  var endDays = 72;
  var cq = quarterOf(todayText());      // current quarter
  var p1 = prevQuarter(cq);
  var p2 = prevQuarter(p1);

  return {
    profile: {
      fullName: "Demo Honorary Consul",
      title: "Honorary Consul",
      mission: "Demo City, Demo Country",
      jurisdictions: ["Demo City", "Demo Region"],
      headOfMission: "Demo Ambassador",
      appointmentDate: daysFromNow(-1020),
      contractEndDate: daysFromNow(endDays),
      email: "demo.consul@example.org",
      phone: "+000 000 000 000",
      officeAddress: "1 Demo Street, Demo City"
    },

    notifications: [
      { id: "n1", type: "expiry",   read: false, date: daysFromNow(-1),
        title: "Contract expiry reminder",
        message: "Your contract ends in " + endDays + " days. Renewal is reviewed by the Head of Mission and HQ." },
      { id: "n2", type: "report",   read: false, date: daysFromNow(-3),
        title: "Quarterly report due soon",
        message: "Your " + cq + " report is due on " + prettyDate(quarterEnd(cq)) + "." },
      { id: "n3", type: "workflow", read: false, date: daysFromNow(-9),
        title: "Report received",
        message: "Your " + p1 + " report was received and is under review by the Head of Mission." },
      { id: "n4", type: "workflow", read: true,  date: daysFromNow(-20),
        title: "Submission receipt issued",
        message: "Your " + p1 + " report was submitted successfully." },
      { id: "n5", type: "workflow", read: true,  date: daysFromNow(-60),
        title: "Welcome to e-HCMS",
        message: "Your account is active. Keep your work log up to date throughout the quarter." }
    ],

    workLog: [
      { id: "w1", date: daysFromNow(-2),  status: "completed", attachments: [],
        title: "Met a local business delegation about trade links",
        notes: "Discussed opportunities for Kenyan exporters and shared the Mission's contact details." },
      { id: "w2", date: daysFromNow(-6),  status: "completed", attachments: ["travel-document-query.pdf"],
        title: "Assisted a Kenyan citizen with a travel document query",
        notes: "Explained the renewal steps and referred the person to the Mission." },
      { id: "w3", date: daysFromNow(-11), status: "ongoing",   attachments: [],
        title: "Preparing the community engagement event",
        notes: "Venue booked. Invitations to go out next week." },
      { id: "w4", date: daysFromNow(-19), status: "completed", attachments: [],
        title: "Attended a diaspora networking evening", notes: "" },
      { id: "w5", date: daysFromNow(-55), status: "completed", attachments: [],
        title: "Hosted a consular information session",
        notes: "About 30 attendees. Shared guidance on documents and registration." },
      { id: "w6", date: daysFromNow(-80), status: "completed", attachments: [],
        title: "Followed up with the local chamber of commerce", notes: "" }
    ],

    reports: [
      { id: reportId(cq), quarter: cq, dueDate: quarterEnd(cq), status: "not_started",
        submittedAt: null, reference: null, content: emptyContent() },
      { id: reportId(p1), quarter: p1, dueDate: quarterEnd(p1), status: "submitted",
        submittedAt: daysFromNow(-20), reference: referenceFor(p1, 42),
        content: {
          summary: "Held community engagement sessions, supported citizens with consular queries and met local business leaders.",
          achievements: "Three new business contacts introduced to the Mission.",
          challenges: "Limited office hours during the holiday period.",
          plans: "Plan a diaspora networking event and update the community contact list.",
          attachments: ["quarter-summary.pdf"]
        } },
      { id: reportId(p2), quarter: p2, dueDate: quarterEnd(p2), status: "submitted",
        submittedAt: daysFromNow(-110), reference: referenceFor(p2, 31),
        content: {
          summary: "Supported citizens with document queries and attended two community events.",
          achievements: "Registered 12 new members of the local diaspora community.",
          challenges: "Few venues available for events.",
          plans: "Build links with local business groups.",
          attachments: []
        } }
    ],

    hom: freshHomMock(cq, p1)
  };
}

function freshHomMock(cq, p1) {
  var p2 = prevQuarter(p1);
  var p3 = prevQuarter(p2);

  function pq(quarter, entries, status) { return { quarter: quarter, entries: entries, reportStatus: status }; }
  function ev(id, quarter, rating, comment, daysAgo) {
    return { id: id, quarter: quarter, rating: rating, comment: comment, date: daysFromNow(-daysAgo) };
  }
  function content(summary, achievements) {
    return { summary: summary, achievements: achievements, challenges: "", plans: "", attachments: [] };
  }
  function rep(id, consulId, consulName, quarter, daysAgo, ref, status, comment, c) {
    return { id: id, consulId: consulId, consulName: consulName, quarter: quarter,
      submittedAt: daysFromNow(-daysAgo), reference: referenceFor(quarter, ref),
      status: status, reviewedAt: status === "reviewed" ? daysFromNow(-Math.max(daysAgo - 4, 1)) : null,
      comment: comment, content: c };
  }

  return {
    profile: { name: "Demo Ambassador", title: "Head of Mission", mission: "Demo Mission, Demo Country" },

    consuls: [
      { id: "c1", name: "Demo Honorary Consul", city: "Demo City", email: "demo.consul@example.org", phone: "+000 000 000 001",
        appointmentDate: daysFromNow(-1020), contractEndDate: daysFromNow(72),
        lastActivity: daysFromNow(-2), entriesThisQuarter: 4, reportStatus: "not_started" },
      { id: "c2", name: "Demo Consul B", city: "Demo City B", email: "consul.b@example.org", phone: "+000 000 000 002",
        appointmentDate: daysFromNow(-700), contractEndDate: daysFromNow(400),
        lastActivity: daysFromNow(-5), entriesThisQuarter: 6, reportStatus: "draft" },
      { id: "c3", name: "Demo Consul C", city: "Demo City C", email: "consul.c@example.org", phone: "+000 000 000 003",
        appointmentDate: daysFromNow(-1070), contractEndDate: daysFromNow(25),
        lastActivity: daysFromNow(-12), entriesThisQuarter: 2, reportStatus: "not_started" },
      { id: "c4", name: "Demo Consul D", city: "Demo City D", email: "consul.d@example.org", phone: "+000 000 000 004",
        appointmentDate: daysFromNow(-480), contractEndDate: daysFromNow(610),
        lastActivity: daysFromNow(-48), entriesThisQuarter: 0, reportStatus: "not_started" },
      { id: "c5", name: "Demo Consul E", city: "Demo City E", email: "consul.e@example.org", phone: "+000 000 000 005",
        appointmentDate: daysFromNow(-900), contractEndDate: daysFromNow(180),
        lastActivity: daysFromNow(-3), entriesThisQuarter: 8, reportStatus: "submitted" }
    ],

    reports: [
      rep("h1", "c5", "Demo Consul E", cq, 3, 51, "pending_review", "",
          content("Hosted two community meetings and supported citizens with consular queries.", "Strong turnout at both events.")),
      rep("h2", "c2", "Demo Consul B", p1, 22, 44, "pending_review", "",
          content("Met local business groups and assisted with document questions.", "Two new business contacts.")),
      rep("h3", "c3", "Demo Consul C", p1, 25, 45, "pending_review", "",
          content("Followed up on community requests and attended a networking evening.", "")),
      rep("h4", "c1", "Demo Honorary Consul", p1, 20, 42, "reviewed", "Thank you. Good community engagement.",
          content("Held community engagement sessions and met local business leaders.", "Three new business contacts.")),
      rep("h5", "c4", "Demo Consul D", p1, 28, 46, "reviewed", "Please log more activity next quarter.",
          content("Limited activity this quarter.", "")),
      rep("h6", "c5", "Demo Consul E", p1, 27, 47, "reviewed", "Well done.",
          content("Supported citizens and organised an information session.", "30 attendees."))
    ],

    // Quarter by quarter history per consul (newest first)
    performance: {
      c1: { quarters: [pq(cq, 4, "open"), pq(p1, 8, "submitted"), pq(p2, 9, "submitted"), pq(p3, 7, "submitted")],
            evaluations: [ev("e1", p1, "good", "Reliable and active in the community.", 15)] },
      c2: { quarters: [pq(cq, 6, "open"), pq(p1, 6, "submitted"), pq(p2, 8, "submitted"), pq(p3, 10, "submitted")],
            evaluations: [ev("e2", p1, "excellent", "Outstanding engagement with business groups.", 15)] },
      c3: { quarters: [pq(cq, 2, "open"), pq(p1, 3, "submitted"), pq(p2, 1, "missing"), pq(p3, 4, "late")],
            evaluations: [ev("e3", p2, "satisfactory", "Report was missing. Needs closer follow-up.", 100)] },
      c4: { quarters: [pq(cq, 0, "open"), pq(p1, 1, "submitted"), pq(p2, 3, "submitted"), pq(p3, 3, "late")],
            evaluations: [ev("e4", p1, "needs_improvement", "Very little activity recorded.", 15)] },
      c5: { quarters: [pq(cq, 8, "open"), pq(p1, 10, "submitted"), pq(p2, 9, "submitted"), pq(p3, 8, "submitted")],
            evaluations: [] }
    },

    recommendations: [
      { id: "rec1", consulId: "c5", consulName: "Demo Consul E", recommendation: "renew_conditions",
        justification: "Strong activity and reports. Recommend renewal with a review after six months.",
        submittedAt: daysFromNow(-6), status: "submitted", hqNote: "" },
      { id: "rec0", consulId: "c2", consulName: "Demo Consul B", recommendation: "renew",
        justification: "Consistent reporting and good community links during the previous contract.",
        submittedAt: daysFromNow(-720), status: "approved", hqNote: "Renewal approved." }
    ],

    notifications: [
      { id: "hn1", type: "report", read: false, date: daysFromNow(-1),
        title: "Reports waiting for your review", message: "Three consul reports are waiting for your review." },
      { id: "hn2", type: "expiry", read: false, date: daysFromNow(-2),
        title: "Contract expiring soon", message: "The contract of Demo Consul C ends in 25 days." },
      { id: "hn3", type: "workflow", read: false, date: daysFromNow(-5),
        title: "No recent activity", message: "Demo Consul D has not logged activity for 48 days." },
      { id: "hn4", type: "workflow", read: true, date: daysFromNow(-30),
        title: "Welcome to e-HCMS", message: "Your Head of Mission account is active." }
    ]
  };
}

function mockStore() {
  try {
    var raw = sessionStorage.getItem(MOCK_KEY);
    if (raw) {
      var existing = JSON.parse(raw);
      if (!existing.hom || !existing.hom.performance) {   // older demo data: add the new part
        var cq = quarterOf(todayText());
        existing.hom = freshHomMock(cq, prevQuarter(cq));
        mockSave(existing);
      }
      return existing;
    }
  } catch (e) {}
  var store = freshMockStore();
  mockSave(store);
  return store;
}

function mockSave(store) {
  try { sessionStorage.setItem(MOCK_KEY, JSON.stringify(store)); } catch (e) {}
}

function unreadIn(list) {
  return list.filter(function (n) { return !n.read; }).length;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function submittedQuarters(store) {
  return store.reports
    .filter(function (r) { return r.status === "submitted"; })
    .map(function (r) { return r.quarter; });
}

function findReport(store, id) {
  for (var i = 0; i < store.reports.length; i++) {
    if (store.reports[i].id === id) return store.reports[i];
  }
  return null;
}

// The report that is still open (not yet submitted), earliest first
function openReport(store) {
  var open = store.reports
    .filter(function (r) { return r.status !== "submitted"; })
    .sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
  return open.length ? open[0] : null;
}

function byDateDesc(a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); }

// Which role is logged in right now
function currentRole() {
  var s = getSession();
  return s && s.user ? s.user.role : "honorary_consul";
}

function isHom() { return currentRole() === "head_of_mission"; }

// Consuls with the days left and the reasons they need attention (the real backend works this out)
function homConsulsView(store) {
  return store.hom.consuls.map(function (c) {
    var days = daysBetweenToday(c.contractEndDate);
    var quiet = -daysBetweenToday(c.lastActivity);       // days since the last activity
    var reasons = [];
    if (days <= 90) reasons.push(days < 0 ? "Contract expired" : "Contract ends in " + days + " days");
    if (quiet > 30) reasons.push("No activity for " + quiet + " days");
    var view = clone(c);
    view.daysRemaining = days;
    view.attentionReasons = reasons;
    return view;
  });
}

function latestRatingOf(store, consulId) {
  var p = store.hom.performance[consulId];
  if (!p || !p.evaluations.length) return null;
  var sorted = p.evaluations.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return sorted[0].rating;
}

function homPerformanceView(store) {
  return store.hom.consuls.map(function (c) {
    var p = store.hom.performance[c.id] || { quarters: [], evaluations: [] };
    var done = p.quarters.filter(function (q) { return q.reportStatus !== "open"; });
    var onTime = done.filter(function (q) { return q.reportStatus === "submitted"; }).length;
    var total = done.reduce(function (sum, q) { return sum + q.entries; }, 0);
    return {
      consulId: c.id, name: c.name, city: c.city,
      metrics: {
        reportsOnTime: onTime,
        reportsTotal: done.length,
        avgEntriesPerQuarter: done.length ? Math.round(total / done.length * 10) / 10 : 0,
        lastActivity: c.lastActivity
      },
      quarters: clone(p.quarters),
      evaluations: clone(p.evaluations).sort(function (a, b) { return a.date < b.date ? 1 : -1; })
    };
  });
}

function homRecommendationsView(store) {
  var waiting = store.hom.recommendations
    .filter(function (r) { return r.status === "submitted"; })
    .map(function (r) { return r.consulId; });

  var needed = homConsulsView(store)
    .filter(function (c) { return c.daysRemaining <= 180 && waiting.indexOf(c.id) === -1; })
    .sort(function (a, b) { return a.daysRemaining - b.daysRemaining; })
    .map(function (c) {
      return { consulId: c.id, name: c.name, city: c.city, contractEndDate: c.contractEndDate,
               daysRemaining: c.daysRemaining, latestRating: latestRatingOf(store, c.id) };
    });

  var submitted = clone(store.hom.recommendations)
    .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });

  return { needed: needed, submitted: submitted };
}

function mockHomDashboard() {
  var store = mockStore();
  var h = store.hom;
  var consuls = homConsulsView(store);
  var attention = consuls.filter(function (c) { return c.attentionReasons.length > 0; });
  var expiring = consuls
    .filter(function (c) { return c.daysRemaining <= 90; })
    .sort(function (a, b) { return a.daysRemaining - b.daysRemaining; });
  var active = consuls.filter(function (c) { return -daysBetweenToday(c.lastActivity) <= 30; }).length;

  return {
    user: { name: h.profile.name, role: "head_of_mission" },
    mission: h.profile.mission,
    totals: {
      consuls: consuls.length,
      attention: attention.length,
      pendingReports: h.reports.filter(function (r) { return r.status === "pending_review"; }).length,
      expiring: expiring.length
    },
    attentionList: attention.map(function (c) { return { id: c.id, name: c.name, city: c.city, reasons: c.attentionReasons }; }),
    expiringList: expiring.map(function (c) { return { id: c.id, name: c.name, endDate: c.contractEndDate, daysRemaining: c.daysRemaining }; }),
    activity: { active: active, total: consuls.length, windowDays: 30 },
    unreadNotifications: unreadIn(h.notifications)
  };
}

function mockDashboard() {
  var store = mockStore();
  var p = store.profile;
  var open = openReport(store);
  var latest = store.reports
    .filter(function (r) { return r.status === "submitted"; })
    .sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : -1; })[0];
  var focus = open || latest;

  return {
    user: { name: p.fullName, role: "honorary_consul" },
    mission: p.mission,
    contract: {
      appointmentDate: p.appointmentDate,
      endDate: p.contractEndDate,
      daysRemaining: daysBetweenToday(p.contractEndDate)
    },
    nextReport: open ? { quarter: open.quarter, dueDate: open.dueDate } : null,
    submission: focus
      ? { quarter: focus.quarter, status: focus.status, submittedAt: focus.submittedAt }
      : null,
    unreadNotifications: unreadIn(store.notifications),
    recentActivity: store.workLog.slice().sort(byDateDesc).slice(0, 4).map(function (w) {
      return { date: w.date, title: w.title, status: w.status };
    })
  };
}


/* ==========================================================
   5) PUBLIC FUNCTIONS (what the pages call)
   ========================================================== */
var Api = {

  /* ---------- Login / session ---------- */
  login: function (workId, password) {
    if (API_CONFIG.USE_MOCK) {
      return wait(600).then(function () {
        // DEMO ONLY: the Work ID chooses the role.
        //   starts with "HOM" -> Head of Mission, starts with "HQ" -> HQ, anything else -> Honorary Consul
        var typed = String(workId || "").trim().toLowerCase();
        var store = mockStore();
        var role = typed.indexOf("hom") === 0 ? "head_of_mission"
                 : typed.indexOf("hq") === 0 ? "hq_admin" : "honorary_consul";
        var name = role === "head_of_mission" ? store.hom.profile.name
                 : role === "hq_admin" ? "Demo HQ Administrator" : store.profile.fullName;
        var session = { token: "demo-token", user: { name: name, role: role } };
        saveSession(session);
        return session;
      });
    }
    var body = { password: password };
    body[API_CONFIG.LOGIN_ID_FIELD] = workId;      // the Work ID goes in the field the backend expects

    return apiRequest("POST", API_CONFIG.ENDPOINTS.login, body)
      .then(function (data) {
        if (data.requires_password_change) {
          var setupSession = {
            token: data.access,
            user: mapLoginResponse(data).user
          };
          saveSession(setupSession);
          return { requiresPasswordChange: true, user: setupSession.user };
        }
        if (data.requires_otp) {
          return {
            requiresOtp: true,
            challengeId: data.challenge_id,
            phoneNumber: data.phone_number
          };
        }
        var session = mapLoginResponse(data);
        saveSession(session);
        return session;
      });
  },

  verifyOtp: function (challengeId, otpCode) {
    return apiRequest("POST", API_CONFIG.ENDPOINTS.verifyOtp, {
      challenge_id: challengeId,
      otp_code: otpCode
    }).then(function (data) {
      var session = mapLoginResponse(data);
      saveSession(session);
      return session;
    });
  },

  changePassword: function (currentPassword, newPassword, confirmPassword) {
    return apiRequest("POST", API_CONFIG.ENDPOINTS.changePassword, {
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword
    }).then(function (data) {
      var session = mapLoginResponse(data);
      saveSession(session);
      return session;
    });
  },

  // Page to open after login for a role (null if that portal does not exist yet)
  homeFor: function (role) {
    return ROLE_HOMES[role] || null;
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
  },

  /* ---------- Dashboard ---------- */
  getDashboard: function () {
    if (API_CONFIG.USE_MOCK) return wait(500).then(mockDashboard);
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.dashboard)
      .then(mapDashboardResponse));
  },

  /* ---------- My Profile ---------- */
  getProfile: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () { return mockStore().profile; });
    }
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.profile)
      .then(mapProfileResponse));
  },

  // changes = { email, phone, officeAddress }  (the only fields a Consul can edit)
  updateProfile: function (changes) {
    if (API_CONFIG.USE_MOCK) {
      return wait(500).then(function () {
        var store = mockStore();
        store.profile.email         = changes.email;
        store.profile.phone         = changes.phone;
        store.profile.officeAddress = changes.officeAddress;
        mockSave(store);
        return store.profile;
      });
    }
    return guardAuth(apiRequest("PUT", API_CONFIG.ENDPOINTS.profile, changes)
      .then(mapProfileResponse));
  },

  /* ---------- Notifications (Consul and Head of Mission) ---------- */
  getNotifications: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () {
        var store = mockStore();
        return isHom() ? store.hom.notifications : store.notifications;
      });
    }
    var path = isHom() ? API_CONFIG.ENDPOINTS.homNotifications : API_CONFIG.ENDPOINTS.notifications;
    return guardAuth(apiRequest("GET", path).then(mapNotificationsResponse));
  },

  // Used for the red number next to "Notifications" in the menu.
  // TODO (real mode): ask the backend for a dedicated unread-count endpoint.
  getUnreadCount: function () {
    return Api.getNotifications().then(unreadIn);
  },

  markNotificationRead: function (id) {
    if (API_CONFIG.USE_MOCK) {
      return wait(250).then(function () {
        var store = mockStore();
        var list = isHom() ? store.hom.notifications : store.notifications;
        list.forEach(function (n) { if (n.id === id) n.read = true; });
        mockSave(store);
        return null;
      });
    }
    var path = isHom() ? API_CONFIG.ENDPOINTS.homNotifications : API_CONFIG.ENDPOINTS.notifications;
    return guardAuth(apiRequest("POST", path + "/" + encodeURIComponent(id) + "/read"));
  },

  markAllNotificationsRead: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(250).then(function () {
        var store = mockStore();
        var list = isHom() ? store.hom.notifications : store.notifications;
        list.forEach(function (n) { n.read = true; });
        mockSave(store);
        return null;
      });
    }
    var path = isHom() ? API_CONFIG.ENDPOINTS.homNotifications : API_CONFIG.ENDPOINTS.notifications;
    return guardAuth(apiRequest("POST", path + "/read-all"));
  },

  /* ---------- Work Log ---------- */
  getWorkLog: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () {
        var store = mockStore();
        var locked = submittedQuarters(store);
        return store.workLog.slice().sort(byDateDesc).map(function (entry) {
          var copy = clone(entry);
          copy.locked = locked.indexOf(quarterOf(entry.date)) !== -1;
          return copy;
        });
      });
    }
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.workLog)
      .then(mapWorkLogResponse));
  },

  // entry = { date, title, notes, status }   files = list of File objects
  addWorkLogEntry: function (entry, files) {
    if (API_CONFIG.USE_MOCK) {
      return wait(500).then(function () {
        var store = mockStore();
        if (submittedQuarters(store).indexOf(quarterOf(entry.date)) !== -1) {
          throw makeError("LOCKED", "That quarter is already submitted");
        }
        var item = {
          id: "w" + Date.now(),
          date: entry.date,
          title: entry.title,
          notes: entry.notes,
          status: entry.status,
          attachments: (files || []).map(function (f) { return f.name; })
        };
        store.workLog.push(item);
        mockSave(store);
        return item;
      });
    }
    return guardAuth(apiRequest("POST", API_CONFIG.ENDPOINTS.workLog, buildForm(entry, files)));
  },

  completeWorkLogEntry: function (id) {
    if (API_CONFIG.USE_MOCK) {
      return wait(300).then(function () {
        var store = mockStore();
        var locked = submittedQuarters(store);
        store.workLog.forEach(function (w) {
          if (w.id === id) {
            if (locked.indexOf(quarterOf(w.date)) !== -1) throw makeError("LOCKED", "Entry is locked");
            w.status = "completed";
          }
        });
        mockSave(store);
        return null;
      });
    }
    return guardAuth(apiRequest("PATCH",
      API_CONFIG.ENDPOINTS.workLog + "/" + encodeURIComponent(id), { status: "completed" }));
  },

  /* ---------- Quarterly Reports ---------- */
  getReports: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () {
        return clone(mockStore().reports).sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : -1; });
      });
    }
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.reports)
      .then(mapReportsResponse));
  },

  // Autosave. content = { summary, achievements, challenges, plans }
  saveReportDraft: function (id, content) {
    if (API_CONFIG.USE_MOCK) {
      return wait(350).then(function () {
        var store = mockStore();
        var report = findReport(store, id);
        if (!report || report.status === "submitted") throw makeError("LOCKED", "Report is submitted");
        report.status = "draft";
        report.content.summary      = content.summary;
        report.content.achievements = content.achievements;
        report.content.challenges   = content.challenges;
        report.content.plans        = content.plans;
        mockSave(store);
        return clone(report);
      });
    }
    return guardAuth(apiRequest("PUT",
      API_CONFIG.ENDPOINTS.reports + "/" + encodeURIComponent(id) + "/draft", content));
  },

  // Final submission. files = list of File objects
  submitReport: function (id, content, files) {
    if (API_CONFIG.USE_MOCK) {
      return wait(800).then(function () {
        var store = mockStore();
        var report = findReport(store, id);
        if (!report || report.status === "submitted") throw makeError("LOCKED", "Report is submitted");

        report.status       = "submitted";
        report.submittedAt  = todayText();
        report.reference    = referenceFor(report.quarter, 40 + store.reports.length * 3);
        report.content      = {
          summary: content.summary,
          achievements: content.achievements,
          challenges: content.challenges,
          plans: content.plans,
          attachments: (files || []).map(function (f) { return f.name; })
        };

        // The next quarter's report opens automatically
        var next = nextQuarter(report.quarter);
        if (!findReport(store, reportId(next))) {
          store.reports.push({ id: reportId(next), quarter: next, dueDate: quarterEnd(next),
            status: "not_started", submittedAt: null, reference: null, content: emptyContent() });
        }

        // A receipt notification, like the real system will send
        store.notifications.unshift({
          id: "n" + Date.now(), type: "workflow", read: false, date: todayText(),
          title: "Submission receipt issued",
          message: "Your " + report.quarter + " report was submitted. Reference: " + report.reference + "."
        });

        mockSave(store);
        return clone(report);
      });
    }
    return guardAuth(apiRequest("POST",
      API_CONFIG.ENDPOINTS.reports + "/" + encodeURIComponent(id) + "/submit",
      buildForm(content, files)));
  },


  /* ==========================================================
     HEAD OF MISSION
     ========================================================== */
  getHomDashboard: function () {
    if (API_CONFIG.USE_MOCK) return wait(500).then(mockHomDashboard);
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.homDashboard)
      .then(mapHomDashboardResponse));
  },

  getHomConsuls: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () { return homConsulsView(mockStore()); });
    }
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.homConsuls)
      .then(mapHomConsulsResponse));
  },

  getHomReports: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () {
        return clone(mockStore().hom.reports).sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
      });
    }
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.homReports)
      .then(mapHomReportsResponse));
  },

  // Marks a report as reviewed, with an optional comment for the consul
  reviewHomReport: function (id, comment) {
    if (API_CONFIG.USE_MOCK) {
      return wait(500).then(function () {
        var store = mockStore();
        var done = null;
        store.hom.reports.forEach(function (r) {
          if (r.id === id) {
            if (r.status === "reviewed") throw makeError("LOCKED", "Already reviewed");
            r.status = "reviewed";
            r.reviewedAt = todayText();
            r.comment = comment || "";
            done = clone(r);
          }
        });
        mockSave(store);
        return done;
      });
    }
    return guardAuth(apiRequest("POST",
      API_CONFIG.ENDPOINTS.homReports + "/" + encodeURIComponent(id) + "/review", { comment: comment || "" }));
  },

  /* ---------- Performance ---------- */
  getHomPerformance: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () { return homPerformanceView(mockStore()); });
    }
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.homPerformance)
      .then(mapHomPerformanceResponse));
  },

  // evaluation = { consulId, quarter, rating, comment }
  addHomEvaluation: function (evaluation) {
    if (API_CONFIG.USE_MOCK) {
      return wait(500).then(function () {
        var store = mockStore();
        var p = store.hom.performance[evaluation.consulId];
        if (!p) throw makeError("SERVER", "Unknown consul");
        var already = p.evaluations.some(function (e) { return e.quarter === evaluation.quarter; });
        if (already) throw makeError("LOCKED", "Already evaluated");
        var item = { id: "e" + Date.now(), quarter: evaluation.quarter, rating: evaluation.rating,
                     comment: evaluation.comment || "", date: todayText() };
        p.evaluations.push(item);
        mockSave(store);
        return item;
      });
    }
    return guardAuth(apiRequest("POST", API_CONFIG.ENDPOINTS.homEvaluations, evaluation));
  },

  /* ---------- Recommendations ---------- */
  getHomRecommendations: function () {
    if (API_CONFIG.USE_MOCK) {
      return wait(400).then(function () { return homRecommendationsView(mockStore()); });
    }
    return guardAuth(apiRequest("GET", API_CONFIG.ENDPOINTS.homRecommendations)
      .then(mapHomRecommendationsResponse));
  },

  // rec = { consulId, recommendation, justification }
  submitHomRecommendation: function (rec) {
    if (API_CONFIG.USE_MOCK) {
      return wait(600).then(function () {
        var store = mockStore();
        var consul = store.hom.consuls.filter(function (c) { return c.id === rec.consulId; })[0];
        if (!consul) throw makeError("SERVER", "Unknown consul");
        var waiting = store.hom.recommendations.some(function (r) {
          return r.consulId === rec.consulId && r.status === "submitted";
        });
        if (waiting) throw makeError("LOCKED", "Already sent to HQ");

        store.hom.recommendations.push({
          id: "rec" + Date.now(), consulId: rec.consulId, consulName: consul.name,
          recommendation: rec.recommendation, justification: rec.justification,
          submittedAt: todayText(), status: "submitted", hqNote: ""
        });
        store.hom.notifications.unshift({
          id: "hn" + Date.now(), type: "workflow", read: false, date: todayText(),
          title: "Recommendation sent to HQ",
          message: "Your recommendation for " + consul.name + " was sent to Headquarters."
        });
        mockSave(store);
        return null;
      });
    }
    return guardAuth(apiRequest("POST", API_CONFIG.ENDPOINTS.homRecommendations, rec));
  }
};




