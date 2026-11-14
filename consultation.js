(() => {
  const cfg = window.UBUZIMA_CONFIG || {};
  const apiBase = String(cfg.apiBaseUrl || "").replace(/\/+$/, "");
  const consultationId = new URLSearchParams(window.location.search).get("consultation_id") || "";
  const status = document.querySelector("#consultationCallStatus");
  const joinButton = document.querySelector("#consultationJoin");
  const muteButton = document.querySelector("#consultationMute");
  const cameraButton = document.querySelector("#consultationCamera");
  const hangupButton = document.querySelector("#consultationHangup");
  const localVideo = document.querySelector("#consultationLocalVideo");
  const remoteVideo = document.querySelector("#consultationRemoteVideo");
  const returnLink = document.querySelector("#consultationReturn");
  let role = "";
  let callApi = "";
  let peer;
  let localStream;
  let signalCursor = "0";
  let pollTimer;
  let pendingCandidates = [];
  let closed = false;

  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, { credentials: "include", cache: "no-store", ...options });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(result.error || "Ntivyashobotse gufungura ikiganiro."); error.status = response.status; throw error; }
    return result;
  }

  async function sendSignal(signal) {
    const csrf = await request("/api/auth/csrf");
    await request(`${callApi}/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken },
      body: JSON.stringify({ signal })
    });
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("status-error", isError);
  }

  async function pollSignals() {
    if (closed || !peer) return;
    try {
      const signals = await request(`${callApi}/signals?after=${encodeURIComponent(signalCursor)}`);
      for (const item of signals) {
        signalCursor = item.id;
        const signal = item.signal;
        if (signal.type === "hangup") { endCall(false); setStatus("Uwundi muntu yahejeje ikiganiro."); return; }
        if (signal.type === "offer" && role === "patient" && signal.description) {
          await peer.setRemoteDescription(signal.description);
          for (const candidate of pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await sendSignal({ type: "answer", description: peer.localDescription });
          setStatus("Muriko muravugana.");
        } else if (signal.type === "answer" && role === "doctor" && signal.description && !peer.currentRemoteDescription) {
          await peer.setRemoteDescription(signal.description);
          for (const candidate of pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
          setStatus("Umurwayi yinjiye mu kiganiro.");
        } else if (signal.type === "candidate" && signal.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else pendingCandidates.push(signal.candidate);
        }
      }
    } catch (error) {
      if (!closed) setStatus(error.message, true);
    }
    if (!closed) pollTimer = window.setTimeout(pollSignals, 700);
  }

  async function startCall() {
    joinButton.disabled = true;
    setStatus("Rondera kamera na mikoro...");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localVideo.srcObject = localStream;
      peer = new RTCPeerConnection({ iceServers: window.callIceServers || [] });
      localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
      peer.ontrack = event => { remoteVideo.srcObject = event.streams[0]; };
      peer.onicecandidate = event => {
        if (event.candidate) sendSignal({ type: "candidate", candidate: event.candidate }).catch(error => setStatus(error.message, true));
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") setStatus("Muriko muravugana.");
        else if (peer.connectionState === "failed") setStatus("Ntivyashobotse guhuza. Gerageza uwundi muhora wa interineti canke ugenzure ko TURN yashizweho.", true);
      };
      muteButton.disabled = false;
      cameraButton.disabled = false;
      hangupButton.disabled = false;
      if (role === "doctor") {
        const csrf = await request("/api/auth/csrf");
        await request(`${callApi}/reset`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken }, body: "{}" });
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await sendSignal({ type: "offer", description: peer.localDescription });
        setStatus("Turindiriye ko umurwayi yinjira...");
      } else setStatus("Winjiye. Turindiriye ko umuganga atangura ikiganiro...");
      pollSignals();
    } catch (error) {
      setStatus(error.message || "Emerera kamera na mikoro kugira winjire mu kiganiro.", true);
      joinButton.disabled = false;
      endCall(false);
    }
  }

  async function endCall(notifyPeer = true) {
    if (closed) return;
    closed = true;
    window.clearTimeout(pollTimer);
    if (notifyPeer && callApi) sendSignal({ type: "hangup" }).catch(() => {});
    localStream?.getTracks().forEach(track => track.stop());
    peer?.close();
    peer = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    muteButton.disabled = true;
    cameraButton.disabled = true;
    hangupButton.disabled = true;
    joinButton.disabled = false;
    joinButton.textContent = "Subira winjire";
    setStatus("Ikiganiro carangiye.");
  }

  joinButton.addEventListener("click", () => { closed = false; startCall(); });
  muteButton.addEventListener("click", () => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    muteButton.textContent = track.enabled ? "Funga ijwi" : "Subira ufungure ijwi";
  });
  cameraButton.addEventListener("click", () => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    cameraButton.textContent = track.enabled ? "Funga kamera" : "Subira ufungure kamera";
  });
  hangupButton.addEventListener("click", () => endCall(true));
  window.addEventListener("pagehide", () => {
    closed = true;
    window.clearTimeout(pollTimer);
    localStream?.getTracks().forEach(track => track.stop());
    peer?.close();
  });

  async function initialize() {
    if (!consultationId) throw new Error("Link y'ikiganiro ntiyuzuye.");
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error("Koresha HTTPS canke localhost kandi ukoreshe browser isanzwe kugira uhamagare.");
    }
    const doctorEndpoint = `/api/doctor/consultations/${encodeURIComponent(consultationId)}/call`;
    let staffSession = null;
    try {
      staffSession = await request("/api/staff/session");
    } catch (error) {
      if (error.status !== 401) throw error;
    }

    if (staffSession) {
      if (staffSession.staff?.role !== "doctor") {
        throw new Error("Iyi konti si iya muganga. Injira ukoresheje konti y'umuganga yashinzwe uyu murwayi.");
      }
      const room = await request(doctorEndpoint);
      role = "doctor";
      callApi = doctorEndpoint;
      window.callIceServers = room.ice_servers;
      returnLink.href = "/doctor/";
    } else {
      const patientEndpoint = `/api/patient/care-requests/${encodeURIComponent(consultationId)}/call`;
      const room = await request(patientEndpoint);
      role = "patient";
      callApi = patientEndpoint;
      window.callIceServers = room.ice_servers;
      returnLink.href = "/patient/";
    }
    setStatus(role === "doctor" ? "Gahunda yawe iremewe. Injira igihe umurwayi yiteguye." : "Gahunda yawe iremerwe. Umuganga ni we atangura ikiganiro.");
    if (role === "patient") setStatus("Gahunda yawe iremerwe. Tegereza umuganga atangure ikiganiro.");
    joinButton.textContent = "Subira ugerageze kwinjira";
    await startCall();
  }

  initialize().catch(error => setStatus(error.message, true));
})();
