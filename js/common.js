/* ==========================================================
   e-HCMS COMMON PAGE CODE (all portals)
   Every page calls  Page.init("menu-key", [allowed roles])  once.
   It takes care of: login check, menu, user name, log out,
   notification badge, footer year, logo and background image.

   TO ADD A NEW PAGE TO A MENU later, edit ROLES below.
   ========================================================== */
var Page = (function () {

  /* Each role has its own title, home page and menu.
     TO ADD A PAGE to a menu, change  built: false  to  built: true  when the page exists.
     Role names must match what the backend sends (see ROLE_HOMES in js/api.js). */
  var ROLES = {
    honorary_consul: {
      title: "Honorary Consul",
      home: "dashboard.html",
      nav: [
        { key: "dashboard",     label: "Dashboard",         href: "dashboard.html",         built: true  },
        { key: "profile",       label: "My Profile",        href: "my-profile.html",        built: true  },
        { key: "worklog",       label: "Work Log",          href: "work-log.html",          built: true  },
        { key: "reports",       label: "Quarterly Reports", href: "quarterly-reports.html", built: true  },
        { key: "notifications", label: "Notifications",     href: "notifications.html?v=2",     built: true, badge: true }
      ]
    },
    head_of_mission: {
      title: "Head of Mission",
      home: "hom-dashboard.html",
      nav: [
        { key: "dashboard",       label: "Dashboard",       href: "hom-dashboard.html",       built: true  },
        { key: "consuls",         label: "My Consuls",      href: "hom-consuls.html",         built: true  },
        { key: "reports",         label: "Reports",         href: "hom-reports.html",         built: true  },
        { key: "performance",     label: "Performance",     href: "hom-performance.html",     built: true  },
        { key: "recommendations", label: "Recommendations", href: "hom-recommendations.html", built: true  },
        { key: "notifications",   label: "Notifications",   href: "notifications.html?v=2",       built: true, badge: true }
      ]
    },
    officer: {
      title: "HQ Desk Officer",
      home: "officer.html",
      nav: [
        { key: "registry",      label: "Missions & Contracts", href: "officer.html",       built: true },
        { key: "notifications", label: "Notifications",        href: "notifications.html?v=2", built: true, badge: true }
      ]
    },
    manager: {
      title: "HQ Director",
      home: "manager.html",
      nav: [
        { key: "renewals",      label: "Contract Renewals",   href: "manager.html",       built: true },
        { key: "registry",      label: "Missions & Registry", href: "officer.html",       built: true },
        { key: "notifications", label: "Notifications",       href: "notifications.html?v=2", built: true, badge: true }
      ]
    },
    super_admin: {
      title: "Super Admin",
      home: "super-admin.html",
      nav: [
        { key: "users",         label: "User Provisioning",   href: "super-admin.html",   built: true },
        { key: "renewals",      label: "Contract Renewals",   href: "manager.html",       built: true },
        { key: "registry",      label: "Missions & Registry", href: "officer.html",       built: true },
        { key: "notifications", label: "Notifications",       href: "notifications.html?v=2", built: true, badge: true }
      ]
    }
  };

  /* BACKGROUND SETTINGS for all pages that use this file
     size:     "contain" = whole image fits, "auto 85%" = a bit smaller
     position: "center", "center top", "right center", ... */
  var BG_SIZE     = "contain";
  var BG_POSITION = "center";


  /* ---------- small helpers ---------- */
  function byId(id) { return document.getElementById(id); }

  function formatDate(text) {
    if (!text) return "-";
    var d = new Date(text + "T00:00:00");
    if (isNaN(d)) return text;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function daysUntil(text) {
    if (!text) return null;
    var target = new Date(text + "T00:00:00");
    if (isNaN(target)) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  // Colour level from days left (matches the 90 / 60 / 30 day alerts)
  function levelFor(days) {
    if (days === null) return "grey";
    if (days <= 30)    return "danger";
    if (days <= 60)    return "orange";
    if (days <= 90)    return "warn";
    return "ok";
  }

  function plural(n, word) { return n + " " + word + (Math.abs(n) === 1 ? "" : "s"); }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // Today as YYYY-MM-DD (local time)
  function todayText() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // "2026-11-13" -> "Q4 2026"
  function quarterOf(text) {
    var d = new Date(text + "T00:00:00");
    return "Q" + (Math.floor(d.getMonth() / 3) + 1) + " " + d.getFullYear();
  }

  // Checks files chosen for upload. Returns an error message, or "" if all are fine.
  // The server must check again: this is only to help the user early.
  var ALLOWED_TYPES = ["pdf", "png", "jpg", "jpeg", "docx"];
  var MAX_FILE_MB = 5;
  var MAX_FILES = 5;

  function checkFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (files.length > MAX_FILES) return "You can attach up to " + MAX_FILES + " files.";
    for (var i = 0; i < files.length; i++) {
      var ext = files[i].name.split(".").pop().toLowerCase();
      if (ALLOWED_TYPES.indexOf(ext) === -1) {
        return files[i].name + " is not allowed. Use PDF, PNG, JPG or DOCX files.";
      }
      if (files[i].size > MAX_FILE_MB * 1024 * 1024) {
        return files[i].name + " is larger than " + MAX_FILE_MB + " MB.";
      }
    }
    return "";
  }


  /* ---------- menu ---------- */
  function buildNav(activeKey, role) {
    var nav = byId("mainNav");
    if (!nav) return;
    nav.textContent = "";

    ROLES[role].nav.forEach(function (item) {
      var a = document.createElement("a");
      a.textContent = item.label;

      if (item.built) {
        a.href = item.href;
      } else {
        a.href = "#";
        a.className = "soon";
        a.title = "Coming soon";
        a.setAttribute("aria-disabled", "true");
        a.addEventListener("click", function (e) { e.preventDefault(); });
      }

      if (item.key === activeKey) {
        a.classList.add("active");
        a.setAttribute("aria-current", "page");
      }

      if (item.badge) {
        var badge = document.createElement("span");
        badge.className = "nav-badge";
        badge.id = "notifBadge";
        badge.hidden = true;
        badge.textContent = "0";
        a.appendChild(badge);
      }
      nav.appendChild(a);
    });
  }

  function setBadge(count) {
    var badge = byId("notifBadge");
    if (!badge) return;
    badge.textContent = count;
    badge.hidden = !(count > 0);
  }


  /* ---------- image finder ----------
     Tries several folders and file endings and uses the first
     one that loads. Red 404 lines in the console while it
     searches are normal. */
  var FOLDERS = ["images", "image", "Images", "Image", "."];
  var ENDINGS = [".png", ".PNG", ".jpg", ".jpeg", ".webp", ".png.png"];
  var cache = {};

  function nameVariants(name) {
    var list = [
      name,
      name.replace(/_/g, "-"),
      name.replace(/_/g, " "),
      name.replace(/_/g, ""),
      name.charAt(0).toUpperCase() + name.slice(1),
      name.toUpperCase(),
      name + " (1)"
    ];
    return list.filter(function (n, i) { return list.indexOf(n) === i; });
  }

  function findImage(name) {
    if (cache[name]) return cache[name];

    cache[name] = new Promise(function (resolve) {
      var tries = [];
      nameVariants(name).forEach(function (variant) {
        FOLDERS.forEach(function (folder) {
          ENDINGS.forEach(function (end) {
            tries.push(folder + "/" + variant + end);
          });
        });
      });

      var i = 0;
      (function next() {
        if (i >= tries.length) {
          console.error("Could not find '" + name + "'. Check the exact file name inside the images folder.");
          resolve(null);
          return;
        }
        var test = new Image();
        test.onload = function () {
          console.log("Found " + name + " -> " + tries[i]);
          resolve(tries[i]);
        };
        test.onerror = function () { i++; next(); };
        test.src = tries[i];
      })();
    });

    return cache[name];
  }

  function loadImages() {
    document.querySelectorAll("img[data-name]").forEach(function (img) {
      findImage(img.getAttribute("data-name")).then(function (path) {
        if (path) img.src = path;
      });
    });

    findImage("background_image").then(function (path) {
      var page = byId("page");
      if (path && page) {
        page.style.backgroundImage    = 'url("' + path + '")';
        page.style.backgroundRepeat   = "no-repeat";
        page.style.backgroundSize     = BG_SIZE;
        page.style.backgroundPosition = BG_POSITION;
      }
    });
  }


  /* ---------- start-up ---------- */
  // Returns true if the page may continue, false if the user was sent elsewhere.
  // allowedRoles = who may open this page (default: Honorary Consul only).
  function init(activeKey, allowedRoles) {
    var allowed = allowedRoles || ["honorary_consul"];
    var user = Api.getUser();

    // Convenience only. The real protection must be done by the backend.
    if (!Api.isLoggedIn() || !user || !ROLES[user.role]) {
      window.location.replace("login.html");
      return false;
    }
    if (allowed.indexOf(user.role) === -1) {
      window.location.replace(ROLES[user.role].home);     // send them to their own portal
      return false;
    }

    buildNav(activeKey, user.role);

    var roleEl = byId("headerRole");
    if (roleEl) roleEl.textContent = ROLES[user.role].title;

    var brand = byId("brandLink");
    if (brand) brand.href = ROLES[user.role].home;

    var nameEl = byId("headerName");
    if (nameEl) nameEl.textContent = user.name || "Honorary Consul";

    var year = byId("year");
    if (year) year.textContent = new Date().getFullYear();

    var banner = byId("demoBanner");
    if (banner) banner.hidden = !API_CONFIG.USE_MOCK;

    var logout = byId("logoutBtn");
    if (logout) {
      logout.addEventListener("click", function () {
        Api.logout();
        window.location.href = "login.html";
      });
    }

    Api.getUnreadCount().then(setBadge).catch(function () {});
    loadImages();
    return true;
  }

  return {
    init: init,
    setBadge: setBadge,
    byId: byId,
    formatDate: formatDate,
    daysUntil: daysUntil,
    levelFor: levelFor,
    plural: plural,
    todayText: todayText,
    quarterOf: quarterOf,
    checkFiles: checkFiles
  };
})();