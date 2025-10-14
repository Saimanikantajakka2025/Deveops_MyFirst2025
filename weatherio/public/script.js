// Client-side logic for Weather.io
//
// This script fetches daily weather data from wttr.in, caches it for
// fifteen minutes, merges any user overrides returned from the local
// backend, and updates the UI accordingly.  Overrides are stored
// server-side so that different sessions (or browser tabs) see the
// same edited values.

(function () {
  // Default location: Secunderabad/Hyderabad, India.
  const DEFAULT_LOCATION = {
    lat: 17.385,
    lon: 78.4867,
    tz: "Asia/Kolkata",
  };

  // DOM references
  const latInput = document.getElementById("lat-input");
  const lonInput = document.getElementById("lon-input");
  const saveLocation = document.getElementById("save-location");
  const statusEl = document.getElementById("status");
  const weatherCard = document.getElementById("weather-card");
  const tempEl = document.getElementById("temperature");
  const humidityEl = document.getElementById("humidity");
  const windEl = document.getElementById("wind");
  const precipEl = document.getElementById("precip");
  const conditionIcon = document.getElementById("condition-icon");
  const conditionText = document.getElementById("condition-text");
  const sourceEl = document.getElementById("source");
  const updateBtn = document.getElementById("update-btn");
  const removeBtn = document.getElementById("remove-btn");
  const todayBtn = document.getElementById("today-btn");
  const tomorrowBtn = document.getElementById("tomorrow-btn");
  const dayafterBtn = document.getElementById("dayafter-btn");
  const updateModal = document.getElementById("update-modal");
  const updateForm = document.getElementById("update-form");
  const cancelUpdate = document.getElementById("cancel-update");
  const updTemp = document.getElementById("upd-temp");
  const updHumidity = document.getElementById("upd-humidity");
  const updWind = document.getElementById("upd-wind");
  const updPrecip = document.getElementById("upd-precip");
  const updCondition = document.getElementById("upd-condition");

  // Application state
  let locationData = null;
  let currentDateKey = "today"; // one of 'today', 'tomorrow', 'dayafter'
  let currentWeather = null;
  let currentOverride = null;

  // Initialise location from localStorage or default
  function initLocation() {
    try {
      const stored = localStorage.getItem("weatherLocation");
      if (stored) {
        const obj = JSON.parse(stored);
        if (obj && obj.lat && obj.lon) {
          locationData = obj;
        } else {
          locationData = DEFAULT_LOCATION;
        }
      } else {
        locationData = DEFAULT_LOCATION;
      }
    } catch (e) {
      locationData = DEFAULT_LOCATION;
    }
    latInput.value = locationData.lat;
    lonInput.value = locationData.lon;
  }

  function saveLocationData() {
    locationData.lat = parseFloat(latInput.value);
    locationData.lon = parseFloat(lonInput.value);
    localStorage.setItem("weatherLocation", JSON.stringify(locationData));
    showStatus("Location saved.", "info");
    loadWeather(currentDateKey);
  }

  saveLocation.addEventListener("click", saveLocationData);

  // Compute ISO date string in the target time zone with an offset
  function getDateString(offsetDays) {
    const tz = locationData.tz || "UTC";
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    const parts = now.toLocaleDateString("en-CA", { timeZone: tz }).split("-");
    return parts.join("-");
  }

  // Display a status message
  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.style.color = type === "error" ? "#e74c3c" : "#2c3e50";
    if (!msg) statusEl.textContent = "";
  }

  // Fetch weather from cache or wttr.in
  async function fetchWeather(dateString) {
    const cacheKey = `${locationData.lat},${locationData.lon},${dateString}`;
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem("weatherCache") || "{}");
    } catch (e) {
      cache = {};
    }

    const now = Date.now();
    if (cache[cacheKey] && now - cache[cacheKey].timestamp < 15 * 60 * 1000) {
      return cache[cacheKey].data;
    }

    const url = `https://wttr.in/${locationData.lat},${locationData.lon}?format=j1`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Failed to fetch weather data");

    const data = await resp.json();
    const weatherArr = data.weather || [];

    let weatherDay = weatherArr.find((item) => item.date === dateString);
    if (!weatherDay) weatherDay = weatherArr[0];

    const hourly = weatherDay.hourly || [];
    if (hourly.length === 0) throw new Error("No hourly data available");

    // Compute averages
    let sumTemp = 0,
      sumHumidity = 0,
      sumWind = 0,
      sumPrecip = 0;
    hourly.forEach((entry) => {
      sumTemp += parseFloat(entry.tempC);
      sumHumidity += parseFloat(entry.humidity);
      sumWind += parseFloat(entry.windspeedKmph);
      sumPrecip += parseFloat(entry.precipMM);
    });

    const count = hourly.length;
    const avgTemp = (sumTemp / count).toFixed(1);
    const avgHum = Math.round(sumHumidity / count);
    const avgWind = (sumWind / count).toFixed(1);
    const totalPrecip = sumPrecip.toFixed(1);

    // Use mid-day condition
    const midIndex = Math.floor(count / 2);
    const condition = hourly[midIndex];
    const conditionTextVal =
      (condition.weatherDesc &&
        condition.weatherDesc[0] &&
        condition.weatherDesc[0].value.trim()) ||
      "";
    const conditionCodeVal = parseInt(condition.weatherCode || "0", 10);
    const icon = weatherCodeToIcon(conditionCodeVal);

    const weather = {
      tempC: parseFloat(avgTemp),
      humidityPct: avgHum,
      windKph: parseFloat(avgWind),
      precipMm: parseFloat(totalPrecip),
      conditionText: conditionTextVal,
      conditionIcon: icon,
      source: "api",
    };

    cache[cacheKey] = { data: weather, timestamp: now };
    localStorage.setItem("weatherCache", JSON.stringify(cache));
    return weather;
  }

  // Map codes to emoji icons
  function weatherCodeToIcon(code) {
    if (code === 113) return "☀️";
    if ([116, 119, 122].includes(code)) return "⛅";
    if ([143, 248, 260].includes(code)) return "🌫️";
    if (
      [
        176, 200, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314,
        353, 356, 359, 386, 389,
      ].includes(code)
    )
      return "🌧️";
    if (
      [
        179, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 368, 371,
        374, 377, 392, 395,
      ].includes(code)
    )
      return "❄️";
    return "🌥️";
  }

  // Fetch override from backend
  async function fetchOverride(dateString) {
    const params = new URLSearchParams({
      lat: String(locationData.lat),
      lon: String(locationData.lon),
      date: dateString,
    });
    const resp = await fetch(`/override?${params.toString()}`);
    if (!resp.ok) throw new Error("Failed to fetch override");
    const data = await resp.json();
    return data && data.newValues ? data : null;
  }

  // Load weather and display
  async function loadWeather(dateKey) {
    currentDateKey = dateKey;
    [todayBtn, tomorrowBtn, dayafterBtn].forEach((btn) =>
      btn.classList.remove("active")
    );
    if (dateKey === "today") todayBtn.classList.add("active");
    if (dateKey === "tomorrow") tomorrowBtn.classList.add("active");
    if (dateKey === "dayafter") dayafterBtn.classList.add("active");

    const offset = dateKey === "tomorrow" ? 1 : dateKey === "dayafter" ? 2 : 0;

    const dateString = getDateString(offset);
    showStatus("Loading...", "info");

    try {
      const weather = await fetchWeather(dateString);
      currentWeather = weather;

      const override = await fetchOverride(dateString);
      currentOverride = override;

      let combined = { ...weather };
      let source = "API";
      if (override && override.newValues) {
        combined = { ...combined, ...override.newValues };
        source = `Override (v${override.version})`;
      }

      renderWeather(combined, source);
      showStatus("", "info");
    } catch (err) {
      console.error(err);
      showStatus(err.message || "Error loading weather", "error");
      weatherCard.classList.add("hidden");
    }
  }

  // Render weather card
  function renderWeather(data, source) {
    tempEl.textContent = `${data.tempC.toFixed(1)}°C`;
    humidityEl.textContent = data.humidityPct;
    windEl.textContent = data.windKph.toFixed(1);
    precipEl.textContent = data.precipMm.toFixed(1);
    conditionIcon.textContent = data.conditionIcon;
    conditionText.textContent = data.conditionText;
    sourceEl.textContent = `Source: ${source}`;
    weatherCard.classList.remove("hidden");

    if (currentOverride && currentOverride.active) {
      removeBtn.classList.remove("hidden");
    } else {
      removeBtn.classList.add("hidden");
    }
  }

  // Update modal
  function openUpdateModal() {
    if (!currentWeather) return;
    updTemp.value = currentWeather.tempC;
    updHumidity.value = currentWeather.humidityPct;
    updWind.value = currentWeather.windKph;
    updPrecip.value = currentWeather.precipMm;
    updCondition.value = currentWeather.conditionText;
    updateModal.classList.remove("hidden");
  }

  function closeUpdateModal() {
    updateModal.classList.add("hidden");
  }

  updateBtn.addEventListener("click", openUpdateModal);
  cancelUpdate.addEventListener("click", closeUpdateModal);

  // Save override
  updateForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const offset =
      currentDateKey === "tomorrow" ? 1 : currentDateKey === "dayafter" ? 2 : 0;

    const dateString = getDateString(offset);
    const values = {
      tempC: parseFloat(updTemp.value),
      humidityPct: parseInt(updHumidity.value, 10),
      windKph: parseFloat(updWind.value),
      precipMm: parseFloat(updPrecip.value),
      conditionText: updCondition.value.trim(),
    };

    try {
      const resp = await fetch("/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: String(locationData.lat),
          lon: String(locationData.lon),
          date: dateString,
          values,
        }),
      });
      if (!resp.ok) throw new Error("Failed to save override");
      await resp.json();
      closeUpdateModal();

      const cacheKey = `${locationData.lat},${locationData.lon},${dateString}`;
      let cache = {};
      try {
        cache = JSON.parse(localStorage.getItem("weatherCache") || "{}");
      } catch (e) {
        cache = {};
      }
      delete cache[cacheKey];
      localStorage.setItem("weatherCache", JSON.stringify(cache));

      loadWeather(currentDateKey);
    } catch (err) {
      console.error(err);
      showStatus(err.message || "Error saving override", "error");
    }
  });

  // Remove override
  removeBtn.addEventListener("click", async () => {
    const offset =
      currentDateKey === "tomorrow" ? 1 : currentDateKey === "dayafter" ? 2 : 0;
    const dateString = getDateString(offset);

    try {
      const resp = await fetch("/override", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: String(locationData.lat),
          lon: String(locationData.lon),
          date: dateString,
        }),
      });
      if (!resp.ok) throw new Error("Failed to remove override");
      await resp.json();

      const cacheKey = `${locationData.lat},${locationData.lon},${dateString}`;
      let cache = {};
      try {
        cache = JSON.parse(localStorage.getItem("weatherCache") || "{}");
      } catch (e) {
        cache = {};
      }
      delete cache[cacheKey];
      localStorage.setItem("weatherCache", JSON.stringify(cache));

      loadWeather(currentDateKey);
    } catch (err) {
      console.error(err);
      showStatus(err.message || "Error removing override", "error");
    }
  });

  // Date button handlers
  todayBtn.addEventListener("click", () => loadWeather("today"));
  tomorrowBtn.addEventListener("click", () => loadWeather("tomorrow"));
  dayafterBtn.addEventListener("click", () => loadWeather("dayafter"));

  // Initialize
  initLocation();
  loadWeather("today");
})();
