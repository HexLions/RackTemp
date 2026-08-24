import { useEffect, useState } from "react";
import { api, VersionInfo } from "../api/client";

export default function Footer() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    api.get<VersionInfo>("/version").then(setInfo).catch(() => {});
  }, []);

  if (!info) return null;

  return (
    <footer className="app-footer">
      RackTemp v{info.version} <span className="mono">· {info.commit.slice(0, 7)}</span>
      {" · "}© {new Date().getFullYear()}{" "}
      <a href="https://github.com/HexLions" target="_blank" rel="noreferrer">
        HexLions
      </a>
    </footer>
  );
}
