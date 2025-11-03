import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, remove, onDisconnect, get } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js";
import fetcher from "./fetcher.js";

const main = (async () => {
  const firebaseConfig = await fetcher.load('../res/config/firebaseConfig.json');
  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);

  const liveStream = 'livestream';
  const video = document.getElementById("video");
  const startBtn = document.getElementById("startBtn");
  const joinBtn = document.getElementById("joinBtn");
  const showLocalBtn = document.getElementById("showLocal");
  const showRemoteBtn = document.getElementById("showRemote");
  const roomDisplay = document.getElementById("roomIdDisplay");

  const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  let localStream;
  let remoteStream = new MediaStream();
  let peerConnection;
  let pendingCandidates = [];
  let currentView = "remote";
  let roomId = "";
  const userId = crypto.randomUUID();

  function updateVideoView() {
    video.srcObject = currentView === "local" ? localStream : remoteStream;
  }

  async function cleanupOnExit(roomRef, participantRef) {
    await remove(participantRef);
    const participantsRef = ref(db, `${liveStream}/rooms/${roomId}/participants`);
    const snapshot = await get(participantsRef);
    if (!snapshot.exists()) {
      await remove(roomRef);
    }
  }

  async function start(isCreator) {
    roomId = isCreator ? crypto.randomUUID().slice(0, 8) : prompt("請輸入房間 ID 加入");
    if (!roomId) return;

    roomDisplay.textContent = `房間 ID：${roomId}`;

    const roomRef = ref(db, `${liveStream}/rooms/${roomId}`);
    const offerRef = ref(db, `${liveStream}/rooms/${roomId}/offer`);
    const answerRef = ref(db, `${liveStream}/rooms/${roomId}/answer`);
    const callerCandidatesRef = ref(db, `${liveStream}/rooms/${roomId}/callerCandidates`);
    const calleeCandidatesRef = ref(db, `${liveStream}/rooms/${roomId}/calleeCandidates`);
    const participantRef = ref(db, `${liveStream}/rooms/${roomId}/participants/${userId}`);

    await set(participantRef, true);
    onDisconnect(participantRef).remove();

    window.addEventListener("beforeunload", () => cleanupOnExit(roomRef, participantRef));

    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (err) {
      alert("請允許畫面分享");
      return;
    }

    peerConnection = new RTCPeerConnection(config);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
      event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
      if (currentView === "remote") updateVideoView();
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        const targetRef = isCreator ? callerCandidatesRef : calleeCandidatesRef;
        push(targetRef, event.candidate.toJSON());
      }
    };

    if (isCreator) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      set(offerRef, offer);

      onValue(answerRef, async snapshot => {
        const answer = snapshot.val();
        if (answer && !peerConnection.currentRemoteDescription) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
          pendingCandidates.forEach(c => peerConnection.addIceCandidate(c));
          pendingCandidates = [];
        }
      });

      onValue(calleeCandidatesRef, snapshot => {
        snapshot.forEach(child => {
          const candidate = new RTCIceCandidate(child.val());
          if (peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(candidate);
          } else {
            pendingCandidates.push(candidate);
          }
        });
      });

    } else {
      onValue(offerRef, async snapshot => {
        const offer = snapshot.val();
        if (offer && !peerConnection.currentRemoteDescription) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          set(answerRef, answer);

          pendingCandidates.forEach(c => peerConnection.addIceCandidate(c));
          pendingCandidates = [];
        }
      });

      onValue(callerCandidatesRef, snapshot => {
        snapshot.forEach(child => {
          const candidate = new RTCIceCandidate(child.val());
          if (peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(candidate);
          } else {
            pendingCandidates.push(candidate);
          }
        });
      });
    }

    currentView = "remote";
    updateVideoView();
  }

  startBtn.onclick = () => start(true);
  joinBtn.onclick = () => start(false);
  showLocalBtn.onclick = () => {
    currentView = "local";
    updateVideoView();
  };
  showRemoteBtn.onclick = () => {
    currentView = "remote";
    updateVideoView();
  };
})();
