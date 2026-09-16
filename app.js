// ============================================================
// 제주 클린하우스 찾기 - 메인 로직
// ============================================================
(function () {
  "use strict";

  var KAKAO_APPKEY = "1c2960f3d4b9b2924e9e7e73dc55b16e";

  var BIN_META = [
    { key: "general", label: "종량제", icon: "🗑️" },
    { key: "recycle", label: "재활용", icon: "♻️" },
    { key: "glass", label: "유리병", icon: "🍾" },
    { key: "styrofoam", label: "스티로폼", icon: "📦" },
    { key: "battery", label: "폐건전지", icon: "🔋" },
    { key: "fluor", label: "폐형광등", icon: "💡" },
    { key: "food", label: "음식물", icon: "🍚" },
    { key: "foodMeter", label: "음식물계량", icon: "⚖️" }
  ];

  var GEOCODE_CACHE_KEY = "cleanhouse_geocode_cache_v1";

  var state = {
    map: null,
    clusterer: null,
    geocoder: null,
    places: null,
    houses: [],
    houseById: {},
    markers: {},          // id -> kakao marker
    userPos: null,        // {lat,lng}
    refPos: null,         // current reference point for "nearby" list (user or search)
    refLabel: "",
    userOverlay: null,
    searchMarker: null,
    selectedId: null
  };

  // ---------- helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function toRad(d) { return (d * Math.PI) / 180; }
  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  function fmtDist(km) {
    if (km < 1) return Math.round(km * 1000) + "m";
    return km.toFixed(1) + "km";
  }
  function fmtMin(min) {
    min = Math.max(1, Math.round(min));
    if (min < 60) return min + "분";
    var h = Math.floor(min / 60), m = min % 60;
    return h + "시간 " + (m ? m + "분" : "");
  }
  function todayIdx() { return new Date().getDay(); }

  function todayItems() {
    var cfg = window.SCHEDULE_CONFIG;
    var weekly = cfg.weekly[todayIdx()] || [];
    return { daily: cfg.daily, weekly: weekly };
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  // ---------- init data ----------
  function initHouses() {
    state.houses = window.CLEANHOUSE_DATA || [];
    state.houses.forEach(function (h) { state.houseById[h.id] = h; });
  }

  // ---------- date badge ----------
  function renderDateBadge() {
    var cfg = window.SCHEDULE_CONFIG;
    var d = new Date();
    var txt = (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + cfg.dayNamesShort[d.getDay()] + ") 오늘";
    var badge = el("div", "date-badge", txt);
    $(".brand").appendChild(badge);
  }

  // ---------- schedule modal ----------
  function buildWeekTableHtml(highlightToday) {
    var cfg = window.SCHEDULE_CONFIG;
    var rows = "";
    for (var i = 0; i < 7; i++) {
      var items = cfg.weekly[i] || [];
      var labels = items.map(function (it) { return it.icon + " " + it.label; }).join(", ");
      rows += '<tr class="' + (highlightToday && i === todayIdx() ? "is-today" : "") + '">' +
        "<th>" + cfg.dayNames[i] + "</th><td>" + labels + "</td></tr>";
    }
    var dailyLabels = cfg.daily.map(function (it) { return it.icon + " " + it.label; }).join("<br>");
    var html =
      '<table class="week-table">' +
      "<tr><th>매일</th><td>" + dailyLabels + "</td></tr>" +
      rows +
      "</table>" +
      '<div class="week-note">배출 시간: 일반 재활용품은 ' + cfg.hours.general +
      ", 음식물쓰레기는 " + cfg.hours.food + "<br>" +
      "기준: " + cfg.lastVerified + ". 제도가 바뀔 수 있으니 정확한 내용은 " +
      '<a href="' + cfg.officialUrl + '" target="_blank" rel="noopener">제주특별자치도 홈페이지</a>에서 다시 확인해 주세요.</div>';
    return html;
  }

  function openScheduleModal() {
    $("#scheduleModalBody").innerHTML = buildWeekTableHtml(true);
    $("#scheduleModal").style.display = "flex";
  }
  function closeScheduleModal() {
    $("#scheduleModal").style.display = "none";
  }

  // ---------- today banner (list view) ----------
  function todayBannerHtml() {
    var t = todayItems();
    var chips = t.daily.concat(t.weekly).map(function (it) {
      return '<span class="today-chip">' + it.icon + " " + it.label + "</span>";
    }).join("");
    var cfg = window.SCHEDULE_CONFIG;
    return (
      '<div class="today-banner">' +
      '<div class="label">오늘 배출 가능한 품목</div>' +
      '<div class="today-items">' + chips + "</div>" +
      '<div class="today-hours">배출 시간: ' + cfg.hours.general + " (음식물은 " + cfg.hours.food + ")</div>" +
      "</div>"
    );
  }

  // ---------- list rendering ----------
  function nearestHouses(lat, lng, limit) {
    var list = [];
    for (var i = 0; i < state.houses.length; i++) {
      var h = state.houses[i];
      if (h.lat == null || h.lng == null) continue;
      var d = haversineKm(lat, lng, h.lat, h.lng);
      list.push({ h: h, d: d });
    }
    list.sort(function (a, b) { return a.d - b.d; });
    return list.slice(0, limit || 30);
  }

  function renderList() {
    var body = $("#sheetList");
    var html = todayBannerHtml();

    if (!state.refPos) {
      html +=
        '<div class="prompt-card"><p>내 위치를 확인하면 가까운 클린하우스부터 보여드려요.</p>' +
        '<button id="askLocationBtn">내 위치 확인하기</button></div>';
      html += '<div class="section-label">제주 전체 클린하우스 (' + state.houses.length + '곳)</div>';
      body.innerHTML = html;
      var askBtn = $("#askLocationBtn");
      if (askBtn) askBtn.addEventListener("click", locateUser);
      return;
    }

    var items = nearestHouses(state.refPos.lat, state.refPos.lng, 30);
    html += '<div class="section-label">' + (state.refLabel || "내 위치") + " 근처 클린하우스</div>";
    if (items.length === 0) {
      html += '<div class="empty-state">주변에서 위치 정보가 준비된 클린하우스를 찾고 있어요.<br>잠시 후 다시 확인해 주세요.</div>';
    } else {
      items.forEach(function (it) {
        var h = it.h;
        html +=
          '<div class="house-item" data-id="' + h.id + '">' +
          '<div class="dist-badge">' + fmtDist(it.d) + "</div>" +
          '<div class="info"><div class="name">' + (h.n || "클린하우스") + '</div>' +
          '<div class="addr">' + h.a + "</div></div>" +
          '<div class="chev">›</div></div>';
      });
    }
    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll(".house-item"), function (row) {
      row.addEventListener("click", function () {
        var id = Number(row.getAttribute("data-id"));
        selectHouse(state.houseById[id]);
      });
    });
  }

  // ---------- detail rendering ----------
  function showList() {
    state.selectedId = null;
    $("#sheetList").style.display = "block";
    $("#sheetDetail").style.display = "none";
  }

  function selectHouse(h) {
    if (!h) return;
    state.selectedId = h.id;
    $("#sheetList").style.display = "none";
    var detail = $("#sheetDetail");
    detail.style.display = "block";

    if (h.lat != null && h.lng != null && state.map) {
      state.map.panTo(new kakao.maps.LatLng(h.lat, h.lng));
    }

    var distHtml = "";
    if (state.refPos && h.lat != null && h.lng != null) {
      var km = haversineKm(state.refPos.lat, state.refPos.lng, h.lat, h.lng);
      var walkMin = (km / 4) * 60;
      var driveMin = (km / 22) * 60;
      distHtml =
        '<div class="metric-row">' +
        '<div class="metric-card"><div class="v">' + fmtDist(km) + '</div><div class="k">직선거리</div></div>' +
        '<div class="metric-card"><div class="v">' + fmtMin(walkMin) + '</div><div class="k">🚶 도보 (예상)</div></div>' +
        '<div class="metric-card"><div class="v">' + fmtMin(driveMin) + '</div><div class="k">🚗 차량 (예상)</div></div>' +
        "</div>";
    }

    var t = todayItems();
    var todayChips = t.daily.concat(t.weekly).map(function (it) {
      return '<span class="today-chip">' + it.icon + " " + it.label + "</span>";
    }).join("");
    var cfg = window.SCHEDULE_CONFIG;

    var binsHtml = "";
    if (h.bins) {
      binsHtml += '<div class="section-label">수거함 정보</div><div class="bin-grid">';
      BIN_META.forEach(function (m) {
        var v = h.bins[m.key];
        if (v == null) return;
        binsHtml +=
          '<div class="bin-card"><span class="ic">' + m.icon + '</span>' +
          '<div><div class="num">' + v + '개</div><div class="lb">' + m.label + '</div></div></div>';
      });
      binsHtml += "</div>";
      binsHtml += '<div class="bin-card" style="margin-top:8px;"><span class="ic">📹</span>' +
        '<div><div class="num">' + (h.cctv != null ? h.cctv + "대" : "정보 없음") + '</div><div class="lb">CCTV 설치</div></div></div>';
    } else {
      binsHtml =
        '<div class="section-label">수거함 · CCTV 정보</div>' +
        '<div class="no-data-note">이 클린하우스는 서귀포시 2018년 자료로 등록되어 있어 수거함 개수와 CCTV 정보가 제공되지 않아요. 위치와 주소 정보는 이용하실 수 있어요.</div>';
    }

    var dirUrl = "https://map.kakao.com/link/to/" +
      encodeURIComponent(h.n || "클린하우스") + "," + h.lat + "," + h.lng;

    detail.innerHTML =
      '<button class="back-btn" id="backBtn">‹ 목록으로</button>' +
      '<div class="detail-title">' + (h.n || "클린하우스") + '</div>' +
      '<div class="detail-dong">' + h.d + " · " + (h.c === "J" ? "제주시" : "서귀포시") + '</div>' +
      '<div class="addr-row"><div class="txt">' + h.a + '</div>' +
      '<button class="copy-btn" id="copyBtn">📋 복사</button></div>' +
      distHtml +
      (h.lat != null ? '<a class="directions-btn" href="' + dirUrl + '" target="_blank" rel="noopener">🧭 카카오맵으로 길찾기</a>' : "") +
      '<div class="today-detail"><div class="dayline">오늘(' + cfg.dayNames[todayIdx()] + ') 배출 가능 품목</div>' +
      '<div class="today-items">' + todayChips + '</div>' +
      '<div class="today-hours" style="margin-top:8px;">배출 시간: ' + cfg.hours.general + '</div></div>' +
      binsHtml +
      '<button class="toggle-btn" id="weekToggleBtn">📅 요일별 전체 배출 품목표 보기</button>' +
      '<div id="weekTableWrap" style="display:none;"></div>';

    $("#backBtn").addEventListener("click", showList);
    $("#copyBtn").addEventListener("click", function () {
      copyToClipboard(h.a).then(function () {
        var btn = $("#copyBtn");
        var orig = btn.innerHTML;
        btn.innerHTML = "✓ 복사됨";
        setTimeout(function () { btn.innerHTML = orig; }, 1500);
      });
    });
    $("#weekToggleBtn").addEventListener("click", function () {
      var wrap = $("#weekTableWrap");
      var showing = wrap.style.display !== "none";
      if (showing) {
        wrap.style.display = "none";
        $("#weekToggleBtn").textContent = "📅 요일별 전체 배출 품목표 보기";
      } else {
        wrap.innerHTML = buildWeekTableHtml(true);
        wrap.style.display = "block";
        $("#weekToggleBtn").textContent = "📅 요일별 배출 품목표 접기";
      }
    });

    if (h.lat != null && h.lng != null) bounceMarker(h.id);
  }

  // ---------- map / markers ----------
  function makeMarker(h) {
    var pos = new kakao.maps.LatLng(h.lat, h.lng);
    var marker = new kakao.maps.Marker({ position: pos });
    kakao.maps.event.addListener(marker, "click", function () {
      selectHouse(h);
    });
    state.markers[h.id] = marker;
    return marker;
  }

  function bounceMarker(id) {
    var m = state.markers[id];
    if (!m) return;
    // simple visual feedback: bump the marker's z-index / re-set position triggers no animation in Kakao API,
    // so we just make sure it's on top by removing+adding via clusterer redraw is unnecessary; skip animation.
  }

  function addHousesToMap(houseList) {
    var newMarkers = houseList.map(makeMarker);
    if (state.clusterer) {
      state.clusterer.addMarkers(newMarkers);
    }
  }

  function initMap() {
    var container = $("#map");
    var center = new kakao.maps.LatLng(33.386, 126.5312); // Jeju island center
    state.map = new kakao.maps.Map(container, { center: center, level: 9 });
    state.geocoder = new kakao.maps.services.Geocoder();
    state.places = new kakao.maps.services.Places();

    state.clusterer = new kakao.maps.MarkerClusterer({
      map: state.map,
      averageCenter: true,
      minLevel: 6,
      disableClickZoom: false
    });

    var withCoords = state.houses.filter(function (h) { return h.lat != null && h.lng != null; });
    addHousesToMap(withCoords);

    geocodeMissing();
  }

  // ---------- geocode Seogwipo (no coords in source data) ----------
  function loadGeocodeCache() {
    try {
      return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}");
    } catch (e) { return {}; }
  }
  function saveGeocodeCache(cache) {
    try { localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function geocodeOne(address) {
    return new Promise(function (resolve) {
      state.geocoder.addressSearch(address, function (result, status) {
        if (status === kakao.maps.services.Status.OK && result[0]) {
          resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
        } else {
          resolve(null);
        }
      });
    });
  }

  function geocodeMissing() {
    var cache = loadGeocodeCache();
    var pending = state.houses.filter(function (h) { return h.lat == null; });

    // apply cached first
    var toFetch = [];
    var readyBatch = [];
    pending.forEach(function (h) {
      var hit = cache[h.a];
      if (hit) {
        h.lat = hit.lat; h.lng = hit.lng;
        readyBatch.push(h);
      } else {
        toFetch.push(h);
      }
    });
    if (readyBatch.length) addHousesToMap(readyBatch);

    if (toFetch.length === 0) return;

    var statusEl = $("#geocodeStatus");
    statusEl.style.display = "block";
    var done = 0;
    var total = toFetch.length;
    statusEl.textContent = "서귀포 지역 위치 정보를 불러오는 중… (0/" + total + ")";

    var CONCURRENCY = 6;
    var idx = 0;
    var newlyResolved = [];

    function next() {
      if (idx >= toFetch.length) return Promise.resolve();
      var h = toFetch[idx++];
      return geocodeOne(h.a).then(function (pos) {
        done++;
        if (pos) {
          h.lat = pos.lat; h.lng = pos.lng;
          cache[h.a] = pos;
          newlyResolved.push(h);
        }
        if (done % 10 === 0 || done === total) {
          statusEl.textContent = "서귀포 지역 위치 정보를 불러오는 중… (" + done + "/" + total + ")";
        }
        return next();
      });
    }

    var runners = [];
    for (var i = 0; i < CONCURRENCY; i++) runners.push(next());

    Promise.all(runners).then(function () {
      statusEl.style.display = "none";
      saveGeocodeCache(cache);
      if (newlyResolved.length) addHousesToMap(newlyResolved);
      // if user already viewing a list, refresh so new points are included
      if (!state.selectedId) renderList();
    });
  }

  // ---------- user location ----------
  function setUserOverlay(lat, lng) {
    if (state.userOverlay) state.userOverlay.setMap(null);
    var content = document.createElement("div");
    content.style.cssText =
      "width:16px;height:16px;border-radius:50%;background:#1D4E6B;" +
      "border:3px solid #fff;box-shadow:0 0 0 4px rgba(29,78,107,0.25);";
    state.userOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lng),
      content: content,
      zIndex: 10
    });
    state.userOverlay.setMap(state.map);
  }

  function locateUser() {
    if (!navigator.geolocation) {
      alert("이 브라우저에서는 위치 확인을 지원하지 않아요.");
      return;
    }
    var btn = $("#locateBtn");
    if (btn) btn.textContent = "⏳";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        state.userPos = { lat: lat, lng: lng };
        state.refPos = state.userPos;
        state.refLabel = "내 위치";
        if (state.map) {
          state.map.setCenter(new kakao.maps.LatLng(lat, lng));
          state.map.setLevel(5);
          setUserOverlay(lat, lng);
        }
        if (btn) btn.textContent = "📍";
        if (!state.selectedId) renderList();
      },
      function () {
        if (btn) btn.textContent = "📍";
        alert("위치 권한이 허용되지 않았어요. 기기 설정에서 위치 권한을 허용해 주세요.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  // ---------- search ----------
  function performSearch() {
    var q = $("#searchInput").value.trim();
    if (!q) return;
    var statusEl = $("#searchStatus");
    statusEl.textContent = "검색 중…";

    state.places.keywordSearch(q, function (result, status) {
      if (status !== kakao.maps.services.Status.OK || !result.length) {
        statusEl.textContent = "'" + q + "'에 대한 검색 결과가 없어요. 다른 검색어로 시도해 주세요.";
        return;
      }
      var r = result[0];
      var lat = parseFloat(r.y), lng = parseFloat(r.x);
      statusEl.textContent = "";

      if (state.searchMarker) state.searchMarker.setMap(null);
      state.searchMarker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(lat, lng),
        map: state.map
      });

      state.map.setCenter(new kakao.maps.LatLng(lat, lng));
      state.map.setLevel(5);

      state.refPos = { lat: lat, lng: lng };
      state.refLabel = "'" + (r.place_name || q) + "'";
      showList();
      renderList();
    }, { location: state.map ? state.map.getCenter() : undefined });
  }

  // ---------- wire up UI ----------
  function wireUi() {
    $("#locateBtn").addEventListener("click", locateUser);
    $("#searchBtn").addEventListener("click", performSearch);
    $("#searchInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") performSearch();
    });
    $("#openScheduleBtn").addEventListener("click", openScheduleModal);
    $("#closeScheduleBtn").addEventListener("click", closeScheduleModal);
    $("#scheduleModal").addEventListener("click", function (e) {
      if (e.target.id === "scheduleModal") closeScheduleModal();
    });
    $("#sheetExpandBtn").addEventListener("click", function () {
      var sheet = $("#sheet");
      var expanded = sheet.classList.toggle("expanded");
      $("#sheetExpandBtn").textContent = expanded ? "접기" : "크게 보기";
    });
  }

  // ---------- boot ----------
  function boot() {
    initHouses();
    renderDateBadge();
    wireUi();
    renderList();

    if (typeof kakao === "undefined" || !kakao.maps) {
      $("#map").innerHTML =
        '<div style="padding:24px;font-size:15px;color:#8B4A2B;line-height:1.6;">' +
        "지도를 불러오지 못했어요. 카카오 개발자 사이트에서 이 앱의 도메인이 " +
        "정상적으로 등록되어 있는지 확인해 주세요.</div>";
      return;
    }
    kakao.maps.load(function () {
      initMap();
      locateUser();
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadKakaoThenBoot);
  } else {
    loadKakaoThenBoot();
  }

  function loadKakaoThenBoot() {
    var script = document.createElement("script");
    script.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey=" + KAKAO_APPKEY +
      "&libraries=services,clusterer&autoload=false";
    script.onload = boot;
    script.onerror = boot; // boot() will show the domain-error message
    document.head.appendChild(script);
  }
})();
