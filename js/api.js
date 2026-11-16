/* ==========================================================
   e-HCMS API LAYER — CONNECTED TO DJANGO BACKEND
   ========================================================== */

var API_CONFIG = {
  USE_MOCK: false,
  BASE_URL: "http://127.0.0.1:8000",
  ENDPOINTS: {
    login:         "/api/auth/login/",
    verifyOtp:     "/api/auth/verify-otp/",
    consuls:       "/api/contracts/consuls/",
    appointments:  "/api/contracts/appointments/",
    missions:      "/api/contracts/missions/",
    worklogs:      "/api/worklogs/",
    reports:       "/api/reports/",
    notifications: "/api/notifications/",
    markAllRead:   "/api/notifications/mark-all-read/"
  }
};

var SESSION_KEY = "ehcms_session";

function normalizeRole(backendRole) {
  if (backendRole === "consul") return "honorary_consul";
  return backendRole;
}

function mapNotificationCategory(cat) {
  if (!cat) return "workflow";
  if (cat.indexOf("expiry") !== -1 || cat.indexOf("renewal") !== -1) return "expiry";
  if (cat.indexOf("report") !== -1) return "report";
  return "workflow";
}

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

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

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
      var err = new Error("Server not reachable. Ensure Django is running on " + API_CONFIG.BASE_URL);
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
        return res.json().catch(function () { return {}; }).then(function (errData) {
          var serverErr = new Error(errData.error || errData.detail || ("Server error " + res.status));
          serverErr.code = "SERVER";
          serverErr.status = res.status;
          throw serverErr;
        });
      }
      return res.json();
    });
}
var Api = {
  login: function (workId, password) {
    return apiRequest("POST", API_CONFIG.ENDPOINTS.login, {
      work_id: workId,
      password: password
    }).then(function (loginData) {
      if (loginData.access && loginData.user) {
        var directSession = {
          token: loginData.access,
          refresh: loginData.refresh,
          user: {
            id: loginData.user.id,
            workId: loginData.user.work_id,
            name: loginData.user.full_name,
            email: loginData.user.email,
            phone: loginData.user.phone_number,
            role: normalizeRole(loginData.user.role)
          }
        };
        saveSession(directSession);
        return directSession;
      }

      if (!loginData.challenge_id) {
        throw new Error("Login challenge was not returned by the server.");
      }

      var otpCode = window.prompt(
        "An SMS verification code has been sent to your phone.\n\nEnter the 6-digit OTP code:"
      );
      if (!otpCode) {
        throw new Error("OTP verification cancelled.");
      }

      return apiRequest("POST", API_CONFIG.ENDPOINTS.verifyOtp, {
        challenge_id: loginData.challenge_id,
        otp_code: otpCode.trim()
      }).then(function (verifyData) {
        var session = {
          token: verifyData.access,
          refresh: verifyData.refresh,
          user: {
            id: verifyData.user.id,
            workId: verifyData.user.work_id,
            name: verifyData.user.full_name,
            email: verifyData.user.email,
            phone: verifyData.user.phone_number,
            role: normalizeRole(verifyData.user.role)
          }
        };
        saveSession(session);
        return session;
      });
    });
  },

  getDashboard: function () {
    var session = getSession();
    return Promise.all([
      apiRequest("GET", API_CONFIG.ENDPOINTS.consuls),
      apiRequest("GET", API_CONFIG.ENDPOINTS.appointments),
      apiRequest("GET", API_CONFIG.ENDPOINTS.worklogs),
      apiRequest("GET", API_CONFIG.ENDPOINTS.reports),
      apiRequest("GET", API_CONFIG.ENDPOINTS.notifications)
    ]).then(function (results) {
      var consuls = asArray(results[0]);
      var contracts = asArray(results[1]);
      var worklogs = asArray(results[2]);
      var reports = asArray(results[3]);
      var notifications = asArray(results[4]);

      var profile = consuls[0] || {};
      var currentContract = contracts.find(function (c) { return c.is_current; }) || contracts[0] || {};
      var latestReport = reports[0] || null;
      var unreadCount = notifications.filter(function (n) { return !n.is_read; }).length;

      var now = new Date();
      var currentQuarter = Math.floor(now.getMonth() / 3) + 1;
      var quarterEndDates = { 1: "-03-31", 2: "-06-30", 3: "-09-30", 4: "-12-31" };

      var jurisdictionText = profile.cities_of_operation
        ? profile.cities_of_operation + " (" + (profile.mission_name || "Assigned Mission") + ")"
        : (profile.mission_name || "Assigned Diplomatic Mission");

      return {
        user: session ? session.user : { name: profile.full_name || "Honorary Consul", role: "honorary_consul" },
        mission: jurisdictionText,
        contract: {
          appointmentDate: profile.date_of_first_appointment || currentContract.start_date || null,
          endDate: currentContract.end_date || null,
          daysRemaining: currentContract.days_remaining !== undefined ? currentContract.days_remaining : null,
          referenceNumber: currentContract.reference_number || "-"
        },
        nextReport: {
          quarter: "Q" + currentQuarter + " " + now.getFullYear(),
          dueDate: now.getFullYear() + quarterEndDates[currentQuarter]
        },
        submission: latestReport
          ? {
              quarter: "Q" + latestReport.quarter + " " + latestReport.year,
              status: latestReport.status,
              submittedAt: latestReport.submitted_at ? latestReport.submitted_at.slice(0, 10) : null
            }
          : { quarter: "Q" + currentQuarter + " " + now.getFullYear(), status: "not_started", submittedAt: null },
        unreadNotifications: unreadCount,
        recentActivity: worklogs.slice(0, 5).map(function (log) {
          return {
            date: log.activity_date,
            title: log.title,
            status: log.is_locked ? "completed" : "ongoing"
          };
        })
      };
    }).catch(function (err) {
      if (err.code === "AUTH") clearSession();
      throw err;
    });
  },

  getProfile: function () {
    var session = getSession();
    return Promise.all([
      apiRequest("GET", API_CONFIG.ENDPOINTS.consuls),
      apiRequest("GET", API_CONFIG.ENDPOINTS.appointments),
      apiRequest("GET", API_CONFIG.ENDPOINTS.missions)
    ]).then(function (results) {
      var consuls = asArray(results[0]);
      var contracts = asArray(results[1]);
      var missions = asArray(results[2]);

      var profile = consuls[0] || {};
      var currentContract = contracts.find(function (c) { return c.is_current; }) || contracts[0] || {};
      var mission = missions.find(function (m) { return m.id === profile.mission; }) || {};
      var jurisdictions = (profile.cities_of_operation || "")
        .split(",")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);

      return {
        id: profile.id,
        fullName: profile.full_name || (session && session.user.name) || "-",
        title: "Honorary Consul",
        mission: profile.mission_name || mission.name || "-",
        headOfMission: mission.head_of_mission_name || "-",
        jurisdictions: jurisdictions,
        appointmentDate: profile.date_of_first_appointment || currentContract.start_date || null,
        contractEndDate: currentContract.end_date || null,
        email: profile.email || (session && session.user.email) || "",
        phone: profile.phone_number || (session && session.user.phone) || "",
        officeAddress: profile.office_address || ""
      };
    });
  },

  updateProfile: function (payload) {
    return Api.getProfile().then(function (existing) {
      if (!existing.id) throw new Error("Consul profile ID not found.");
      return apiRequest("PATCH", API_CONFIG.ENDPOINTS.consuls + existing.id + "/", {
        office_address: payload.officeAddress
      }).then(function () {
        return Api.getProfile();
      });
    });
  },

  getNotifications: function () {
    return apiRequest("GET", API_CONFIG.ENDPOINTS.notifications).then(function (data) {
      return asArray(data).map(function (n) {
        return {
          id: n.id,
          type: mapNotificationCategory(n.category),
          title: n.title,
          message: n.message,
          date: n.created_at ? n.created_at.slice(0, 10) : null,
          read: !!n.is_read
        };
      });
    });
  },

  getUnreadCount: function () {
    return apiRequest("GET", API_CONFIG.ENDPOINTS.notifications).then(function (data) {
      return asArray(data).filter(function (n) { return !n.is_read; }).length;
    });
  },

  markNotificationRead: function (id) {
    return apiRequest("POST", API_CONFIG.ENDPOINTS.notifications + id + "/mark-read/");
  },

  markAllNotificationsRead: function () {
    return apiRequest("POST", API_CONFIG.ENDPOINTS.markAllRead);
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

/* ---------- Work Logs & Quarterly Reports API Methods ---------- */
Api.getWorkLogs = function () {
  return apiRequest("GET", API_CONFIG.ENDPOINTS.worklogs).then(asArray);
};

Api.createWorkLog = function (payload) {
  return apiRequest("POST", API_CONFIG.ENDPOINTS.worklogs, payload);
};

Api.deleteWorkLog = function (id) {
  return fetch(API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.worklogs + id + "/", {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + (getSession() || {}).token }
  }).then(function (res) {
    if (!res.ok) throw new Error("Could not delete locked or invalid entry.");
    return true;
  });
};

Api.getReports = function () {
  return apiRequest("GET", API_CONFIG.ENDPOINTS.reports).then(asArray);
};

Api.saveReportDraft = function (reportId, payload) {
  if (reportId) {
    return apiRequest("PATCH", API_CONFIG.ENDPOINTS.reports + reportId + "/", payload);
  }
  return apiRequest("POST", API_CONFIG.ENDPOINTS.reports, payload);
};

Api.uploadReportAttachment = function (reportId, file) {
  var session = getSession();
  var formData = new FormData();
  formData.append("file", file);
  return fetch(API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.reports + reportId + "/attachments/", {
    method: "POST",
    headers: { "Authorization": "Bearer " + (session ? session.token : "") },
    body: formData
  }).then(function (res) {
    if (!res.ok) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        throw new Error(d.error || d.file || "File upload failed.");
      });
    }
    return res.json();
  });
};

Api.submitReport = function (reportId) {
  return apiRequest("POST", API_CONFIG.ENDPOINTS.reports + reportId + "/submit/");
};
