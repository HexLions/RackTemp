import { useEffect, useState } from "react";
import { api, NetworkInfo } from "../api/client";

// window.location.origin is right for a normal browser tab pointed at the
// device's LAN IP, but the Windows tray's embedded WebView2 always navigates
// to https://localhost:<port> (see windows-tray/RackTempTray/MainForm.cs),
// regardless of the server's actual LAN IP - anyone copying an integration
// URL or the sensor's ingest endpoint out of the tray window would get
// "localhost", which only means anything on that same Windows PC, never the
// remote ESP32 sensor or whatever machine is running PRTG/Prometheus/Zabbix.
// Starts with window.location.origin (correct in the overwhelmingly common
// browser case, no flicker) and swaps to a real LAN IP from the backend only
// when the origin turns out to be a loopback address.
export function useDashboardOrigin(): string {
  const [origin, setOrigin] = useState(window.location.origin);

  useEffect(() => {
    const { hostname, protocol } = window.location;
    if (hostname !== "localhost" && hostname !== "127.0.0.1") return;
    api
      .get<NetworkInfo>("/system/network-info")
      .then((info) => {
        if (info.ips.length > 0) setOrigin(`${protocol}//${info.ips[0]}:${info.port}`);
      })
      .catch(() => {
        // Stays on the loopback origin - still copyable, just needs manual
        // editing; not worth surfacing an error for a convenience feature.
      });
  }, []);

  return origin;
}
