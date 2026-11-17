// ==========================================
// MeetPoint - 카카오 맵 & ODsay 대중교통 API 제어
// ==========================================

const KAKAO_REST_API_KEY = '324a499c674a8eb221410bf3e8ae61c1';
const ODSAY_API_KEY = 'm+76DzI6qhrJ4b7uOohCVA';

// ==========================================
// 🔥 Firebase 실시간 DB 설정
// ==========================================
const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

let db = null;
let isFirebaseActive = false;

try {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY") {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        isFirebaseActive = true;
    }
} catch (e) {
    console.warn("Firebase 설정 대기 중: 로컬 모드로 작동합니다.");
}

// 지도 및 서비스 객체
let map = null;
let ps = null;
let geocoder = null;

// 현재 약속 방 데이터
let currentRoom = {
    id: '',
    title: '',
    date: '',
    startTime: '',
    endTime: '',
    placeMode: 'recommend', // 'recommend' (최적 장소 추천) or 'fixed' (장소 직접 지정)
    fixedPlace: null // { name, lat, lng, address }
};

// 상태 관리
let participants = [];
let midpointMarker = null;
let midpointInfowindow = null;
let placeMarkers = [];
let selectedPlace = null;
let customDestSelectedPlace = null;
let fixedPlaceSelected = null;
let debounceTimer = null;
let customDestDebounceTimer = null;
let fixedPlaceDebounceTimer = null;

// 현재 결과 기준 장소 데이터
let currentTargetPlace = {
    name: '',
    lat: 0,
    lng: 0,
    address: ''
};

let lastSubways = [];
let lastPlaces = [];
let lastMidpointAddress = '';
let lastCategoryCode = 'SW8';
let lastCategoryName = '지하철역';

// DOM 로드 완료 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    initKakaoMap();
    initAutocomplete();
    initCustomDestAutocomplete();
    initFixedPlaceAutocomplete();
    initDefaultDates();
    checkUrlForRoom();
});

function initDefaultDates() {
    const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date());
    const dateInput = document.getElementById('roomDate');
    if (dateInput) dateInput.value = today;
}

function initKakaoMap() {
    const container = document.getElementById('map');
    const options = {
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 7
    };
    
    map = new kakao.maps.Map(container, options);
    ps = new kakao.maps.services.Places();
    geocoder = new kakao.maps.services.Geocoder();
}

// ==========================================
// [Step 1] 모임 장소 결정 방식 선택 (추천 vs 직접 지정)
// ==========================================
function selectPlaceMode(mode) {
    currentRoom.placeMode = mode;
    const cardRec = document.getElementById('modeCardRecommend');
    const cardFix = document.getElementById('modeCardFixed');
    const box = document.getElementById('fixedPlaceBox');

    if (mode === 'fixed') {
        cardRec.classList.remove('active');
        cardFix.classList.add('active');
        cardFix.querySelector('input').checked = true;
        box.style.display = 'block';
    } else {
        cardFix.classList.remove('active');
        cardRec.classList.add('active');
        cardRec.querySelector('input').checked = true;
        box.style.display = 'none';
        fixedPlaceSelected = null;
    }
}

// 직접 정하는 장소 검색 자동완성
function initFixedPlaceAutocomplete() {
    const input = document.getElementById('fixedPlaceInput');
    const list = document.getElementById('fixedPlaceAutocompleteList');
    if (!input || !list) return;

    input.addEventListener('input', function() {
        const query = this.value.trim();
        fixedPlaceSelected = null;
        clearTimeout(fixedPlaceDebounceTimer);

        if (!query) {
            list.style.display = 'none';
            list.innerHTML = '';
            return;
        }

        fixedPlaceDebounceTimer = setTimeout(() => {
            if (!ps) return;
            ps.keywordSearch(query, function(data, status) {
                if (status === kakao.maps.services.Status.OK && data.length > 0) {
                    list.innerHTML = '';
                    data.slice(0, 5).forEach(place => {
                        const li = document.createElement('li');
                        li.className = 'autocomplete-item';
                        li.innerHTML = `
                            <div class="autocomplete-item-name">📍 ${place.place_name}</div>
                            <div class="autocomplete-item-address">${place.road_address_name || place.address_name}</div>
                        `;
                        li.addEventListener('click', () => {
                            input.value = place.place_name;
                            fixedPlaceSelected = {
                                name: place.place_name,
                                lat: parseFloat(place.y),
                                lng: parseFloat(place.x),
                                address: place.road_address_name || place.address_name
                            };
                            list.style.display = 'none';
                            list.innerHTML = '';
                        });
                        list.appendChild(li);
                    });
                    list.style.display = 'block';
                } else {
                    list.style.display = 'none';
                }
            });
        }, 250);
    });

    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !list.contains(e.target)) {
            list.style.display = 'none';
        }
    });
}

function toggleTimeInput(inputId, checkbox) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (checkbox.checked) {
        input.disabled = true;
        input.dataset.oldValue = input.value;
        input.value = '';
    } else {
        input.disabled = false;
        input.value = input.dataset.oldValue || (inputId === 'appointmentTime' ? '18:00' : '22:30');
    }
}

// 화면 스텝 전환
function showStep(stepNumber) {
    document.querySelectorAll('.step-view').forEach(el => el.classList.remove('active'));
    const targetStep = document.getElementById(`step${stepNumber}`);
    if (targetStep) targetStep.classList.add('active');

    setTimeout(() => {
        if (map) {
            map.relayout();
            fitBoundsToAll();
        }
    }, 100);
}

function goToStep1() { showStep(1); }
function goToStep2() { showStep(2); }
function goToStep3() { showStep(3); }

function resetToStep1() {
    if (confirm('첫 화면으로 돌아가시겠습니까?')) {
        window.location.href = window.location.pathname;
    }
}

// ==========================================
// [Step 1] 모임 방 생성
// ==========================================
function createRoom() {
    const title = document.getElementById('roomTitle').value.trim();
    const date = document.getElementById('roomDate').value;
    const noStart = document.getElementById('noStartTime').checked;
    const noEnd = document.getElementById('noEndTime').checked;
    const startTime = noStart ? '' : document.getElementById('appointmentTime').value;
    const endTime = noEnd ? '' : document.getElementById('endTime').value;

    if (!title) {
        alert('모임 이름을 입력해주세요!');
        return;
    }

    // 직접 지정 모드인 경우 유효성 검사
    if (currentRoom.placeMode === 'fixed') {
        const fixedInput = document.getElementById('fixedPlaceInput').value.trim();
        if (!fixedInput) {
            alert('정해진 약속 장소를 입력해주세요!');
            return;
        }

        if (!fixedPlaceSelected) {
            // 직접 타이핑 후 목록 안 누른 경우 1차 검색 시도
            ps.keywordSearch(fixedInput, function(data, status) {
                if (status === kakao.maps.services.Status.OK && data.length > 0) {
                    const p = data[0];
                    currentRoom.fixedPlace = {
                        name: p.place_name,
                        lat: parseFloat(p.y),
                        lng: parseFloat(p.x),
                        address: p.road_address_name || p.address_name
                    };
                    proceedCreateRoom(title, date, startTime, endTime);
                } else {
                    alert('입력하신 약속 장소를 찾을 수 없습니다. 다시 검색해주세요.');
                }
            });
            return;
        } else {
            currentRoom.fixedPlace = fixedPlaceSelected;
        }
    } else {
        currentRoom.fixedPlace = null;
    }

    proceedCreateRoom(title, date, startTime, endTime);
}

function proceedCreateRoom(title, date, startTime, endTime) {
    const roomId = 'mp-' + Math.random().toString(36).substring(2, 8);

    currentRoom.id = roomId;
    currentRoom.title = title;
    currentRoom.date = date;
    currentRoom.startTime = startTime;
    currentRoom.endTime = endTime;

    if (isFirebaseActive && db) {
        db.ref(`rooms/${roomId}/info`).set(currentRoom);
    } else {
        localStorage.setItem(`room_${roomId}`, JSON.stringify(currentRoom));
    }

    setupRoomUI();
    listenToParticipants(roomId);

    showStep(2);
    updateCalculateButtonState();
}

function setupRoomUI() {
    document.getElementById('displayRoomTitle').textContent = currentRoom.title;
    
    const startStr = currentRoom.startTime ? `${currentRoom.startTime} 시작` : '시작 시간 미정';
    const endStr = currentRoom.endTime ? `해산: ${currentRoom.endTime}` : '해산 시간 미정';
    document.getElementById('displayRoomMeta').textContent = `📅 ${currentRoom.date || '날짜 미정'} | ⏰ ${startStr} (${endStr})`;
    
    const badgeEl = document.getElementById('displayPlaceModeBadge');
    const catSection = document.getElementById('categorySection');
    const btnCalc = document.getElementById('btnCalculate');
    const inputLabel = document.getElementById('participantInputLabel');
    const addressInput = document.getElementById('userAddress');
    const btnRegister = document.getElementById('btnRegisterParticipant');
    const listTitle = document.getElementById('participantListTitle');

    if (currentRoom.placeMode === 'fixed' && currentRoom.fixedPlace) {
        badgeEl.textContent = `🎯 지정 약속 장소: ${currentRoom.fixedPlace.name}`;
        badgeEl.style.background = '#dbeafe';
        badgeEl.style.color = '#1e40af';
        catSection.style.display = 'none'; // 이미 장소가 정해졌으므로 카테고리 선택 숨김
        btnCalc.textContent = `🚀 [${currentRoom.fixedPlace.name}] 기준 귀가 예상 경로 조회하기`;
        
        // 장소 지정 모드: 집(목적지) 등록 안내로 UI 변경
        if (inputLabel) inputLabel.textContent = '🏠 내 집 / 귀가할 위치 (목적지) 등록하기';
        if (addressInput) addressInput.placeholder = '귀가할 집 주소 또는 도착역 (예: 숭실대, 강남역)';
        if (btnRegister) btnRegister.textContent = '내 집(목적지) 등록';
        if (listTitle) listTitle.textContent = '등록된 친구들의 귀가 목적지';
    } else {
        badgeEl.textContent = `⚖️ 최적 중간 장소 자동 추천 모드`;
        badgeEl.style.background = '#e2e8f0';
        badgeEl.style.color = '#334155';
        catSection.style.display = 'flex';
        btnCalc.textContent = `✨ 중간 장소 및 예상 경로 조회하기`;

        // 추천 모드: 집/학교(출발지) 등록 안내로 UI 변경
        if (inputLabel) inputLabel.textContent = '🚶‍♂️ 내 위치 / 집 (출발지) 등록하기';
        if (addressInput) addressInput.placeholder = '출발역 또는 집/학교 주소 (예: 숭실대, 강남역)';
        if (btnRegister) btnRegister.textContent = '내 출발지 등록';
        if (listTitle) listTitle.textContent = '참여한 친구들의 출발지';
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom.id}`;
    document.getElementById('shareUrlText').textContent = shareUrl;
    window.history.pushState({}, '', `?room=${currentRoom.id}`);
}

function checkUrlForRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (!roomId) return;

    currentRoom.id = roomId;

    if (isFirebaseActive && db) {
        db.ref(`rooms/${roomId}/info`).once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                currentRoom = data;
                setupRoomUI();
            } else {
                setupRoomUI();
            }
        });
    } else {
        const localData = localStorage.getItem(`room_${roomId}`);
        if (localData) {
            currentRoom = JSON.parse(localData);
            setupRoomUI();
        } else {
            setupRoomUI();
        }
    }

    listenToParticipants(roomId);
    showStep(2);
}

function listenToParticipants(roomId) {
    if (isFirebaseActive && db) {
        db.ref(`rooms/${roomId}/participants`).on('value', (snapshot) => {
            const data = snapshot.val();
            participants.forEach(p => {
                p.marker.setMap(null);
                p.infowindow.close();
            });
            participants = [];

            if (data) {
                Object.keys(data).forEach(key => {
                    const p = data[key];
                    registerParticipantLocally(p.name, p.address, p.lat, p.lng, key);
                });
            }
            updateParticipantUI();
            updateCalculateButtonState();
        });
    }
}

function copyShareLink() {
    const shareUrl = document.getElementById('shareUrlText').textContent;
    navigator.clipboard.writeText(shareUrl).then(() => {
        alert('📋 친구들에게 보낼 초대 링크가 복사되었습니다!\n스마트폰이나 단톡방에 붙여넣어 공유하세요.');
    }).catch(() => {
        alert('링크 복사에 실패했습니다. 주소창의 링크를 복사해주세요.');
    });
}

// ==========================================
// [Step 2] 출발지 자동완성 및 참여자 등록
// ==========================================
function initAutocomplete() {
    const addressInput = document.getElementById('userAddress');
    const autocompleteList = document.getElementById('autocompleteList');

    addressInput.addEventListener('input', function() {
        const query = this.value.trim();
        selectedPlace = null;
        clearTimeout(debounceTimer);

        if (!query) {
            closeAutocomplete();
            return;
        }

        debounceTimer = setTimeout(() => {
            if (!ps) return;
            ps.keywordSearch(query, function(data, status) {
                if (status === kakao.maps.services.Status.OK && data.length > 0) {
                    renderAutocompleteList(data.slice(0, 5));
                } else {
                    closeAutocomplete();
                }
            });
        }, 250);
    });

    document.addEventListener('click', function(e) {
        if (!addressInput.contains(e.target) && !autocompleteList.contains(e.target)) {
            closeAutocomplete();
        }
    });
}

function renderAutocompleteList(places) {
    const autocompleteList = document.getElementById('autocompleteList');
    autocompleteList.innerHTML = '';

    places.forEach(place => {
        const li = document.createElement('li');
        li.className = 'autocomplete-item';
        const addressText = place.road_address_name || place.address_name;
        li.innerHTML = `
            <div class="autocomplete-item-name">📍 ${place.place_name}</div>
            <div class="autocomplete-item-address">${addressText}</div>
        `;
        li.addEventListener('click', () => {
            const addressInput = document.getElementById('userAddress');
            addressInput.value = place.place_name;
            selectedPlace = place;
            closeAutocomplete();
            addressInput.focus();
        });
        autocompleteList.appendChild(li);
    });

    autocompleteList.style.display = 'block';
}

function closeAutocomplete() {
    const autocompleteList = document.getElementById('autocompleteList');
    if (autocompleteList) {
        autocompleteList.style.display = 'none';
        autocompleteList.innerHTML = '';
    }
}

function addParticipant() {
    const nameInput = document.getElementById('userName');
    const addressInput = document.getElementById('userAddress');
    const name = nameInput.value.trim();
    const address = addressInput.value.trim();

    if (!name || !address) {
        alert('이름과 출발지를 모두 입력해주세요!');
        return;
    }

    closeAutocomplete();

    if (selectedPlace && selectedPlace.place_name === address) {
        saveParticipantData(name, selectedPlace.place_name, selectedPlace.y, selectedPlace.x);
        nameInput.value = '';
        addressInput.value = '';
        selectedPlace = null;
        return;
    }

    ps.keywordSearch(address, function(data, status) {
        if (status === kakao.maps.services.Status.OK) {
            saveParticipantData(name, data[0].place_name, data[0].y, data[0].x);
            nameInput.value = '';
            addressInput.value = '';
            selectedPlace = null;
        } else {
            geocoder.addressSearch(address, function(addrData, addrStatus) {
                if (addrStatus === kakao.maps.services.Status.OK) {
                    saveParticipantData(name, addrData[0].address_name, addrData[0].y, addrData[0].x);
                    nameInput.value = '';
                    addressInput.value = '';
                    selectedPlace = null;
                } else {
                    alert(`'${address}' 장소나 주소를 찾을 수 없습니다. 다시 입력해주세요.`);
                }
            });
        }
    });
}

function saveParticipantData(name, placeName, lat, lng) {
    const participantData = {
        name: name,
        address: placeName,
        lat: parseFloat(lat),
        lng: parseFloat(lng)
    };

    if (isFirebaseActive && db && currentRoom.id) {
        db.ref(`rooms/${currentRoom.id}/participants`).push(participantData);
    } else {
        registerParticipantLocally(name, placeName, lat, lng);
        updateParticipantUI();
        updateCalculateButtonState();
    }
}

function registerParticipantLocally(name, placeName, lat, lng, key = null) {
    const coords = new kakao.maps.LatLng(lat, lng);
    const marker = new kakao.maps.Marker({ map: map, position: coords });
    
    const isFixed = currentRoom.placeMode === 'fixed';
    const tag = isFixed ? '귀가 목적지' : '출발지';

    const infowindow = new kakao.maps.InfoWindow({
        content: `<div style="padding:6px 10px;font-size:12px;font-weight:bold;color:#1e293b;">👤 ${name} <span style="font-weight:normal;color:#64748b;">(${tag}: ${placeName})</span></div>`
    });
    infowindow.open(map, marker);

    participants.push({
        key: key,
        name: name,
        address: placeName,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        marker: marker,
        infowindow: infowindow
    });

    fitBoundsToAll();
}

function updateParticipantUI() {
    const listElement = document.getElementById('participantList');
    const countElement = document.getElementById('participantCount');
    
    listElement.innerHTML = '';
    countElement.textContent = participants.length;

    const isFixed = currentRoom.placeMode === 'fixed';
    const tag = isFixed ? '귀가 목적지' : '출발지';

    participants.forEach((p, index) => {
        const li = document.createElement('li');
        li.className = 'participant-item';
        li.innerHTML = `
            <span><b>${p.name}</b> (${tag}: ${p.address})</span>
            <button class="btn-delete" onclick="removeParticipant(${index})">삭제</button>
        `;
        listElement.appendChild(li);
    });
}

function removeParticipant(index) {
    const p = participants[index];
    if (isFirebaseActive && db && currentRoom.id && p.key) {
        db.ref(`rooms/${currentRoom.id}/participants/${p.key}`).remove();
    } else {
        p.marker.setMap(null);
        p.infowindow.close();
        participants.splice(index, 1);
        updateParticipantUI();
        updateCalculateButtonState();
        if (participants.length > 0) fitBoundsToAll();
    }
}

function updateCalculateButtonState() {
    const btn = document.getElementById('btnCalculate');
    const notice = document.getElementById('calculateNotice');
    
    // 직접 지정 모드인 경우 1명 이상이면 계산 가능, 추천 모드인 경우 2명 이상 필요
    const minCount = (currentRoom.placeMode === 'fixed') ? 1 : 2;

    if (participants.length >= minCount) {
        btn.disabled = false;
        notice.style.display = 'none';
    } else {
        btn.disabled = true;
        notice.style.display = 'block';
        notice.textContent = (currentRoom.placeMode === 'fixed') 
            ? '참여자를 1명 이상 등록하면 산출할 수 있습니다.' 
            : '친구를 2명 이상 등록하면 산출할 수 있습니다.';
    }
}

function fitBoundsToAll() {
    if (participants.length === 0) return;
    const bounds = new kakao.maps.LatLngBounds();
    participants.forEach(p => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
    if (midpointMarker) bounds.extend(midpointMarker.getPosition());
    map.setBounds(bounds);
}

// ==========================================
// [Step 3] 중간 지점 계산 및 카테고리 검색
// ==========================================
async function calculateMidpoint() {
    // 1. 직접 지정 모드인 경우: 지정된 장소 기준으로 즉시 산출!
    if (currentRoom.placeMode === 'fixed' && currentRoom.fixedPlace) {
        showStep(3);
        recalculateForPlace(
            currentRoom.fixedPlace.name,
            currentRoom.fixedPlace.lat,
            currentRoom.fixedPlace.lng,
            currentRoom.fixedPlace.address
        );
        return;
    }

    // 2. 최적 장소 추천 모드인 경우: 참여자 2명 이상 필수
    if (participants.length < 2) {
        alert('최소 2명 이상의 참여자가 필요합니다!');
        return;
    }

    showStep(3);

    const resultContent = document.getElementById('resultContent');
    resultContent.innerHTML = `<div style="text-align:center; padding:40px 0; color:#64748b;">
        <b>🔄 최적 중간역과 대중교통 예상 경로 정보를 산출 중입니다...</b>
    </div>`;

    let sumLat = 0, sumLng = 0;
    participants.forEach(p => {
        sumLat += p.lat;
        sumLng += p.lng;
    });
    const midLat = sumLat / participants.length;
    const midLng = sumLng / participants.length;
    const midCoords = new kakao.maps.LatLng(midLat, midLng);

    if (midpointMarker) midpointMarker.setMap(null);
    if (midpointInfowindow) midpointInfowindow.close();

    midpointMarker = new kakao.maps.Marker({
        map: map,
        position: midCoords,
        image: new kakao.maps.MarkerImage(
            'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
            new kakao.maps.Size(28, 40)
        )
    });

    geocoder.coord2Address(midLng, midLat, function(result, status) {
        let addressText = '중간 지점 인근';
        if (status === kakao.maps.services.Status.OK && result[0]) {
            addressText = result[0].road_address 
                ? result[0].road_address.address_name 
                : result[0].address.address_name;
        }
        lastMidpointAddress = addressText;

        midpointInfowindow = new kakao.maps.InfoWindow({
            content: `<div style="padding:7px 12px;font-size:12px;font-weight:bold;color:#0284c7;text-align:center;">⭐ 추천 중간 지점<br><span style="font-size:11px;font-weight:normal;color:#475569;">${addressText}</span></div>`
        });
        midpointInfowindow.open(map, midpointMarker);

        fetchRecommendations(midCoords, midLat, midLng, addressText);
    });

    fitBoundsToAll();
}

// ==========================================
// 🍻 사용자 지정 25대 주요 상권 (유흥가 및 번화가 공식 좌표 DB)
// ==========================================
const POPULAR_HOTSPOTS = [
    { name: '강남역', lat: 37.497952, lng: 127.027619, desc: '강남역 메인 상권 / 강남대로' },
    { name: '논현동', lat: 37.511116, lng: 127.021577, desc: '영동시장 / 논현 먹자골목' },
    { name: '압구정 로데오·청담', lat: 37.526839, lng: 127.039869, desc: '압구정로데오 / 청담 명품거리' },
    { name: '홍대입구', lat: 37.556844, lng: 126.923832, desc: '홍대 걷고싶은거리 / 어울마당로' },
    { name: '연남·합정', lat: 37.558778, lng: 126.924851, desc: '연트럴파크 / 합정 카페거리' },
    { name: '이태원·한남', lat: 37.534533, lng: 126.994582, desc: '이태원 세계음식거리 / 한남동' },
    { name: '건대입구', lat: 37.540417, lng: 127.069229, desc: '건대 맛의거리 / 양꼬치골목' },
    { name: '성수동', lat: 37.544583, lng: 127.055972, desc: '성수동 카페거리 / 연무장길' },
    { name: '신촌', lat: 37.555986, lng: 126.936952, desc: '신촌 연세로 / 명물거리' },
    { name: '혜화(대학로)', lat: 37.582298, lng: 127.001809, desc: '대학로 연극거리 / 마로니에공원' },
    { name: '을지로', lat: 37.566318, lng: 126.992284, desc: '힙지로 / 을지로 골뱅이골목' },
    { name: '신당', lat: 37.565814, lng: 127.017772, desc: '신당동 떡볶이타운 / 힙당동' },
    { name: '종각(관철동)', lat: 37.570188, lng: 126.982925, desc: '종각 젊음의거리' },
    { name: '종로3가(익선동)', lat: 37.571607, lng: 126.991806, desc: '익선동 한옥마을 / 포차거리' },
    { name: '명동', lat: 37.563606, lng: 126.984860, desc: '명동 예술극장 / 쇼핑거리' },
    { name: '여의도', lat: 37.521624, lng: 126.924191, desc: '더현대 서울 / 여의도 번화가' },
    { name: '가산디지털단지', lat: 37.481072, lng: 126.882343, desc: '가산 로데오 / 아울렛거리' },
    { name: '잠실(방이동·잠실새내)', lat: 37.513261, lng: 127.100133, desc: '방이동 먹자골목 / 잠실새내 먹자거리' },
    { name: '노원', lat: 37.654358, lng: 127.060572, desc: '노원 문화의거리' },
    { name: '수유', lat: 37.637372, lng: 127.024667, desc: '수유역 먹자골목 / 번화가' },
    { name: '성신여대입구', lat: 37.592624, lng: 127.016492, desc: '하나로거리 / 성신여대 로데오' },
    { name: '영등포', lat: 37.515661, lng: 126.907628, desc: '타임스퀘어 / 영등포 먹자골목' },
    { name: '신림', lat: 37.484269, lng: 126.929739, desc: '순대타운 / 신림역 먹자골목' },
    { name: '서울대입구(샤로수길)', lat: 37.478953, lng: 126.952778, desc: '샤로수길 번화가' },
    { name: '연신내', lat: 37.618638, lng: 126.920629, desc: '연신내 로데오거리' },
    { name: '마곡', lat: 37.560183, lng: 126.825442, desc: '마곡나루 / 발산역 먹자상권' }
];

function fetchRecommendations(midCoords, midLat, midLng, midpointAddress) {
    const customKeyword = document.getElementById('customKeyword').value.trim();
    const categoryCode = document.getElementById('categorySelect').value;

    // 1단계: 중간 지점 주변 지하철역 검색 (기본 필수 순위 제공)
    ps.categorySearch('SW8', function(subwayData, subwayStatus) {
        const subways = (subwayStatus === kakao.maps.services.Status.OK) ? subwayData.slice(0, 3) : [];
        lastSubways = subways;
        const bestStation = subways.length > 0 ? subways[0] : null;

        // 카테고리별 맞춤 장소 탐색 분기
        if (customKeyword) {
            lastCategoryCode = 'CUSTOM';
            lastCategoryName = customKeyword;
            // 직접 입력 키워드 검색
            ps.keywordSearch(customKeyword, function(placesData, pStatus) {
                const places = (pStatus === kakao.maps.services.Status.OK) ? placesData : [];
                const target = (places.length > 0) ? places[0] : (bestStation || { place_name: '중간 지점', y: midLat, x: midLng });
                currentTargetPlace = { name: target.place_name, lat: parseFloat(target.y), lng: parseFloat(target.x), address: midpointAddress };
                lastPlaces = places;
                renderResults(midpointAddress, subways, target.place_name, parseFloat(target.y), parseFloat(target.x), places, true, 'CUSTOM', customKeyword);
            }, {
                location: bestStation ? new kakao.maps.LatLng(bestStation.y, bestStation.x) : midCoords,
                radius: 3000,
                sort: kakao.maps.services.SortBy.DISTANCE
            });
        } else if (categoryCode === 'PUB') {
            lastCategoryCode = 'PUB';
            lastCategoryName = '유흥가 및 번화가';
            // 🎯 [유흥가 및 번화가]: 지정된 25개 주요 번화가 중에서 중심점과 가장 가까운 곳들만 정밀 추천
            const sortedHotspots = POPULAR_HOTSPOTS.map(spot => {
                const distMeter = Math.round(calculateHaversineDistance(midLat, midLng, spot.lat, spot.lng) * 1000);
                return {
                    place_name: spot.name,
                    road_address_name: spot.desc,
                    address_name: spot.desc,
                    y: spot.lat,
                    x: spot.lng,
                    distance: distMeter,
                    place_url: `https://map.kakao.com/link/search/${encodeURIComponent(spot.name)}`
                };
            }).sort((a, b) => a.distance - b.distance);

            const bestHotspot = sortedHotspots[0];
            const topHotspots = sortedHotspots.slice(0, 5);
            lastPlaces = topHotspots;

            // 1순위 번화가 인근의 지하철역도 보강 검색
            ps.categorySearch('SW8', function(hotspotSubwayData, hStatus) {
                const finalSubways = (hStatus === kakao.maps.services.Status.OK && hotspotSubwayData.length > 0)
                    ? hotspotSubwayData.slice(0, 3)
                    : subways;
                lastSubways = finalSubways;

                currentTargetPlace = {
                    name: bestHotspot.place_name,
                    lat: bestHotspot.y,
                    lng: bestHotspot.x,
                    address: bestHotspot.road_address_name
                };

                renderResults(midpointAddress, finalSubways, bestHotspot.place_name, bestHotspot.y, bestHotspot.x, topHotspots, true, 'PUB', '유흥가 및 번화가');
            }, {
                location: new kakao.maps.LatLng(bestHotspot.y, bestHotspot.x),
                radius: 2000,
                sort: kakao.maps.services.SortBy.DISTANCE
            });
        } else if (categoryCode === 'CINEMA') {
            // 🎯 [영화관]: 중심점 / 최적 지하철역 인근 영화관 검색
            const searchCenter = bestStation ? new kakao.maps.LatLng(bestStation.y, bestStation.x) : midCoords;
            ps.keywordSearch('영화관', function(cinemaData, cStatus) {
                const cinemas = (cStatus === kakao.maps.services.Status.OK) ? cinemaData : [];
                lastPlaces = cinemas;

                if (cinemas.length > 0) {
                    const bestCinema = cinemas[0];
                    currentTargetPlace = {
                        name: bestCinema.place_name,
                        lat: parseFloat(bestCinema.y),
                        lng: parseFloat(bestCinema.x),
                        address: bestCinema.road_address_name || bestCinema.address_name
                    };
                    renderResults(midpointAddress, subways, bestCinema.place_name, parseFloat(bestCinema.y), parseFloat(bestCinema.x), cinemas, true, 'CINEMA', '영화관');
                } else {
                    const fallbackTarget = bestStation ? bestStation.place_name : '중간 지점';
                    const targetLat = bestStation ? parseFloat(bestStation.y) : midLat;
                    const targetLng = bestStation ? parseFloat(bestStation.x) : midLng;
                    renderResults(midpointAddress, subways, fallbackTarget, targetLat, targetLng, [], true, 'CINEMA', '영화관');
                }
            }, {
                location: searchCenter,
                radius: 4000,
                sort: kakao.maps.services.SortBy.DISTANCE
            });
        } else if (categoryCode === 'SHOP' || categoryCode === 'LIB' || categoryCode === 'BUS') {
            // [백화점/도서관/버스정류장]: 맞춤 장소 카테고리 검색
            const catNameMap = { 'SHOP': '백화점 및 쇼핑몰', 'LIB': '도서관', 'BUS': '버스정류장' };
            const searchKeyword = categoryCode === 'SHOP' ? '백화점' : (categoryCode === 'LIB' ? '도서관' : '버스정류장');
            const searchCenter = bestStation ? new kakao.maps.LatLng(bestStation.y, bestStation.x) : midCoords;

            ps.keywordSearch(searchKeyword, function(placesData, pStatus) {
                const places = (pStatus === kakao.maps.services.Status.OK) ? placesData : [];
                lastPlaces = places;
                const target = (places.length > 0) ? places[0] : (bestStation || { place_name: '중간 지점', y: midLat, x: midLng });
                currentTargetPlace = { name: target.place_name, lat: parseFloat(target.y), lng: parseFloat(target.x), address: midpointAddress };
                renderResults(midpointAddress, subways, target.place_name, parseFloat(target.y), parseFloat(target.x), places, true, categoryCode, catNameMap[categoryCode]);
            }, {
                location: searchCenter,
                radius: 4000,
                sort: kakao.maps.services.SortBy.DISTANCE
            });
        } else {
            // [기본 지하철역 (SW8)]
            const targetLat = bestStation ? parseFloat(bestStation.y) : midLat;
            const targetLng = bestStation ? parseFloat(bestStation.x) : midLng;
            const targetName = bestStation ? bestStation.place_name : '중간 지점';

            currentTargetPlace = { name: targetName, lat: targetLat, lng: targetLng, address: midpointAddress };
            lastPlaces = subways;
            renderResults(midpointAddress, subways, targetName, targetLat, targetLng, subways, true, 'SW8', '지하철역');
        }
    }, {
        location: midCoords,
        radius: 4000,
        sort: kakao.maps.services.SortBy.DISTANCE
    });
}

// ==========================================
// 🎯 장소 직접 변경 및 재계산
// ==========================================
function initCustomDestAutocomplete() {
    const input = document.getElementById('customDestInput');
    const list = document.getElementById('customDestAutocompleteList');

    input.addEventListener('input', function() {
        const query = this.value.trim();
        customDestSelectedPlace = null;
        clearTimeout(customDestDebounceTimer);

        if (!query) {
            list.style.display = 'none';
            list.innerHTML = '';
            return;
        }

        customDestDebounceTimer = setTimeout(() => {
            if (!ps) return;
            ps.keywordSearch(query, function(data, status) {
                if (status === kakao.maps.services.Status.OK && data.length > 0) {
                    list.innerHTML = '';
                    data.slice(0, 5).forEach(place => {
                        const li = document.createElement('li');
                        li.className = 'autocomplete-item';
                        li.innerHTML = `
                            <div class="autocomplete-item-name">📍 ${place.place_name}</div>
                            <div class="autocomplete-item-address">${place.road_address_name || place.address_name}</div>
                        `;
                        li.addEventListener('click', () => {
                            input.value = place.place_name;
                            customDestSelectedPlace = place;
                            list.style.display = 'none';
                            list.innerHTML = '';
                            recalculateForPlace(place.place_name, parseFloat(place.y), parseFloat(place.x), place.road_address_name || place.address_name);
                        });
                        list.appendChild(li);
                    });
                    list.style.display = 'block';
                } else {
                    list.style.display = 'none';
                }
            });
        }, 250);
    });

    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !list.contains(e.target)) {
            list.style.display = 'none';
        }
    });
}

function searchAndChangeTarget() {
    const input = document.getElementById('customDestInput');
    const query = input.value.trim();
    if (!query) {
        alert('재계산할 장소를 입력해주세요!');
        return;
    }

    if (customDestSelectedPlace && customDestSelectedPlace.place_name === query) {
        recalculateForPlace(
            customDestSelectedPlace.place_name,
            parseFloat(customDestSelectedPlace.y),
            parseFloat(customDestSelectedPlace.x),
            customDestSelectedPlace.road_address_name || customDestSelectedPlace.address_name
        );
        return;
    }

    ps.keywordSearch(query, function(data, status) {
        if (status === kakao.maps.services.Status.OK && data.length > 0) {
            const p = data[0];
            recalculateForPlace(p.place_name, parseFloat(p.y), parseFloat(p.x), p.road_address_name || p.address_name);
        } else {
            alert(`'${query}' 장소를 찾을 수 없습니다. 다시 검색해주세요.`);
        }
    });
}

async function recalculateForPlace(placeName, lat, lng, address) {
    currentTargetPlace = { name: placeName, lat: lat, lng: lng, address: address };

    const pos = new kakao.maps.LatLng(lat, lng);
    map.panTo(pos);
    map.setLevel(4);

    if (midpointMarker) {
        midpointMarker.setPosition(pos);
        if (midpointInfowindow) {
            midpointInfowindow.setContent(`<div style="padding:7px 12px;font-size:12px;font-weight:bold;color:#0284c7;text-align:center;">🎯 약속 장소: ${placeName}<br><span style="font-size:11px;font-weight:normal;color:#475569;">${address || ''}</span></div>`);
            midpointInfowindow.open(map, midpointMarker);
        }
    }

    const resultContent = document.getElementById('resultContent');
    resultContent.innerHTML = `<div style="text-align:center; padding:30px 0; color:#64748b;">
        <b>🔄 [${placeName}] 기준으로 전원 이동 시간 및 대중교통 경로를 산출 중입니다...</b>
    </div>`;

    renderResults(address || lastMidpointAddress, lastSubways, placeName, lat, lng, lastPlaces, false, lastCategoryCode, lastCategoryName);
}

// ==========================================
// 🎨 서울교통공사 & 국토부 & 서울/경기 버스 표준 가이드라인 색상 헬퍼
// ==========================================
function getSubwayColorClass(lineName) {
    if (!lineName) return 'segment-subway';
    if (lineName.includes('1호선')) return 'segment-subway-1';
    if (lineName.includes('2호선')) return 'segment-subway-2';
    if (lineName.includes('3호선')) return 'segment-subway-3';
    if (lineName.includes('4호선')) return 'segment-subway-4';
    if (lineName.includes('5호선')) return 'segment-subway-5';
    if (lineName.includes('6호선')) return 'segment-subway-6';
    if (lineName.includes('7호선')) return 'segment-subway-7';
    if (lineName.includes('8호선')) return 'segment-subway-8';
    if (lineName.includes('9호선')) return 'segment-subway-9';
    if (lineName.includes('신분당')) return 'segment-subway-shinbundang';
    if (lineName.includes('수인') || lineName.includes('분당')) return 'segment-subway-suin';
    if (lineName.includes('경의') || lineName.includes('중앙')) return 'segment-subway-gyeongui';
    if (lineName.includes('경춘')) return 'segment-subway-gyeongchun';
    if (lineName.includes('공항')) return 'segment-subway-airport';
    if (lineName.includes('KTX')) return 'segment-train-ktx';
    if (lineName.includes('SRT')) return 'segment-train-srt';
    return 'segment-subway';
}

// ==========================================
// 🚌 ODsay 대중교통 길찾기 + 실제 지하철/버스 공식 막차 시간표 API 연동
// ==========================================
// 조회 실패 시 임의 경로/요금/막차를 생성하지 않습니다.
function escapeTransitHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function searchODsayTransit(originLng, originLat, destLng, destLat) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        if (![originLng, originLat, destLng, destLat].every(Number.isFinite)) {
            return {status: 'unavailable', message: '출발지 또는 도착지 좌표가 올바르지 않습니다.'};
        }
        const params = new URLSearchParams({apiKey: ODSAY_API_KEY,
            SX: String(originLng), SY: String(originLat),
            EX: String(destLng), EY: String(destLat)});
        const response = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${params}`, {signal: controller.signal});
        if (!response.ok) {
            return {status: 'unavailable', message: `교통정보 서버 요청에 실패했습니다 (HTTP ${response.status}).`};
        }
        const data = await response.json();
        if (data.error) {
            const err = Array.isArray(data.error) ? data.error[0] : data.error;
            return {status: 'unavailable', message: `교통정보 조회 오류${err?.code != null ? ' [' + err.code + ']' : ''}: ${err?.msg || err?.message || '인증·허용 도메인·호출 한도 등을 확인해 주세요.'}`};
        }
        const paths = (Array.isArray(data.result?.path) ? data.result.path : [])
            .filter(p => Number.isFinite(p.info?.totalTime) && p.info.totalTime >= 0 && Array.isArray(p.subPath));
        if (!paths.length) return {status: 'unavailable', message: '제공된 대중교통 경로가 없습니다. 가까운 거리 또는 서비스 미지원 구간일 수 있습니다.'};
        // 반환된 후보 중 최소 예상시간 경로. 실제 운행일/실시간 운행 보장은 아님.
        const bestPath = [...paths].sort((a,b) => a.info.totalTime - b.info.totalTime)[0];
        const info = bestPath.info;
        const timelineSegments = [];
        const verticalSteps = [];
        let totalWalkMins = 0;
        let walkKnown = true;
        let boardings = 0;
        const finite = v => Number.isFinite(v) && v >= 0;
        const safe = escapeTransitHtml;
        bestPath.subPath.forEach(sp => {
            const known = finite(sp.sectionTime);
            const mins = known ? sp.sectionTime : null;
            if (sp.trafficType === 3) {
                if (!known) walkKnown = false;
                else totalWalkMins += mins;
                if (!known || mins > 0) {
                    timelineSegments.push({icon:'🚶', time: mins ?? 1, label: known ? `${mins}분` : '미확인', cssClass:'segment-walk'});
                    verticalSteps.push({type:'end', dotClass:'end', stationName:'도보 이동',
                        walkDesc:known ? `이 구간 도보 약 ${mins}분` : '이 구간 도보시간 정보 없음'});
                }
                return;
            }
            if (sp.trafficType !== 1 && sp.trafficType !== 2) return;
            boardings++;
            const subway = sp.trafficType === 1;
            const lane = sp.lane?.[0] || {};
            const name = subway ? String(lane.name ?? '지하철').replace('수도권 ', '') : String(lane.busNo ?? '버스');
            timelineSegments.push({icon:subway ? '🚇' : '🚌', time:mins ?? 1,
                label:known ? `${mins}분` : '미확인',
                cssClass:subway ? getSubwayColorClass(name) : 'segment-bluebus'});
            verticalSteps.push({type:'transit', dotClass:subway?'subway':'blue', badgeIcon:subway?'🚇':'🚌',
                badgeText:safe(subway ? name : '버스'), badgeClass:subway?'v-badge-subway':'v-badge-blue',
                stationName:safe(sp.startName ?? '승차 지점 정보 없음'), infoTag:sp.way ? `${safe(sp.way)} 방면` : '',
                lineName:safe(name), lineBoxClass:subway?'subway':'blue',
                moveDesc:`${safe(sp.endName ?? '하차 지점 정보 없음')}까지${known ? ` (약 ${mins}분)` : ' (구간시간 정보 없음)'}`});
        });
        const totalMinutes = info.totalTime;
        return {status:'ok', isRealApi:true, totalMinutes,
            hours:Math.floor(totalMinutes / 60), remainMinutes:totalMinutes % 60,
            payment:finite(info.payment) ? info.payment : null,
            totalWalkTime:walkKnown ? totalWalkMins : null,
            transitCount:Math.max(0, boardings - 1),
            officialLastTrainTime:null, timelineSegments, verticalSteps,
            fetchedAt:new Date().toISOString()};
    } catch (error) {
        return {status:'unavailable', message:error.name === 'AbortError'
            ? '교통정보 요청 시간이 초과되었습니다. 다시 계산해 주세요.'
            : '교통정보를 불러오지 못했습니다. 네트워크, API 허용 도메인 및 인증 설정을 확인해 주세요.'};
    } finally {
        clearTimeout(timer);
    }
}

// 운행일·종착역·모든 환승이 검증되기 전에는 막차 시각이나 안전 여부를 추정하지 않습니다.
function calculateLastTrainMargin() {
    return {lastTrainTime:null, badgeClass:'safe-yellow', badgeText:'🟡 막차 확인 필요',
        detailText:'운행일별 시간표와 전체 환승 연결이 검증되지 않아 막차·귀가 가능 여부를 확정할 수 없습니다.'};
}

let transitRenderVersion = 0;

// 최종 결과 렌더링
async function renderResults(midpointAddress, subways, targetName, targetLat, targetLng, places, isDefaultRecommended, categoryCode = 'SW8', categoryName = '지하철역') {
    const renderVersion = ++transitRenderVersion;
    const roomParticipants = [...participants];
    const endTime = currentRoom.endTime || '';
    const isFixed = currentRoom.placeMode === 'fixed';
    
    placeMarkers.forEach(m => m.setMap(null));
    placeMarkers = [];

    // 상단 타이틀 구성
    let headerTitle = `📍 ${isDefaultRecommended ? '1순위 추천 중간 장소' : '선택한 약속 장소'}: ${targetName}`;
    let subAddress = `위치: ${midpointAddress || '주변 지역'}`;

    if (categoryCode === 'PUB') {
        headerTitle = `🍻 25개 주요 번화가 최적 추천: ${targetName}`;
        subAddress = `중간 지점 기준 가장 가까운 주요 상권 (${midpointAddress || ''})`;
    } else if (categoryCode === 'CINEMA') {
        headerTitle = `🎬 맞춤 최적 영화관: ${targetName}`;
        subAddress = `중간 지점 인근 최적 영화관 (${midpointAddress || ''})`;
    } else if (categoryCode !== 'SW8') {
        headerTitle = `📍 맞춤 최적 ${categoryName}: ${targetName}`;
        subAddress = `중간 지점 인근 최적 장소 (${midpointAddress || ''})`;
    }

    let html = `
        <div class="midpoint-header">
            <h3>${headerTitle}</h3>
            <div class="midpoint-address">${subAddress}</div>
        </div>
    `;

    // 🚇 추천 중간 지하철역 순위 (지하철역이 아닌 카테고리를 골라도 지하철역 순위는 항상 필수 제공)
    if (subways && subways.length > 0) {
        html += `<b>🚇 추천 중간 지하철역 순위 (TOP ${subways.length})</b><div class="subway-rank-list">`;
        subways.forEach((sub, idx) => {
            html += `
                <div class="subway-rank-item">
                    <div onclick="focusOnPlace(${sub.y}, ${sub.x})" style="cursor:pointer; flex:1;">
                        <span class="subway-badge">${idx + 1}순위</span>
                        <b>${sub.place_name}</b>
                        <span style="color:#64748b; font-size:11px; margin-left:6px;">중심에서 ${sub.distance}m</span>
                    </div>
                    <button class="btn-select-place" onclick="recalculateForPlace('${sub.place_name}', ${sub.y}, ${sub.x}, '${sub.road_address_name || sub.address_name}')">
                        👉 이 역으로 계산
                    </button>
                </div>
            `;
        });
        html += `</div>`;
    }

    // 🎯 맞춤 장소 카테고리 추천 목록 (영화관, 25개 번화가, 쇼핑몰, 도서관 등)
    if (categoryCode !== 'SW8' && places && places.length > 0) {
        const topSlice = places.slice(0, 5);
        let catTitle = `✨ ${categoryName} 추천 순위 (TOP ${topSlice.length})`;
        if (categoryCode === 'PUB') catTitle = `🍻 25개 주요 번화가 추천 순위 (TOP ${topSlice.length})`;
        if (categoryCode === 'CINEMA') catTitle = `🎬 인근 추천 영화관 순위 (TOP ${topSlice.length})`;

        html += `<div style="margin-top:14px;"><b>${catTitle}</b><ul class="place-list">`;
        topSlice.forEach((place) => {
            const placePos = new kakao.maps.LatLng(place.y, place.x);
            const marker = new kakao.maps.Marker({ map: map, position: placePos });
            const info = new kakao.maps.InfoWindow({
                content: `<div style="padding:5px 8px;font-size:11.5px;"><b>${place.place_name}</b><br><span style="color:#64748b;font-size:10.5px;">${place.road_address_name || place.address_name || ''}</span></div>`
            });
            kakao.maps.event.addListener(marker, 'click', function() { info.open(map, marker); });
            placeMarkers.push(marker);

            const distText = place.distance ? `(${place.distance}m)` : '';

            html += `
                <li class="place-item">
                    <div style="flex:1;">
                        <a href="${place.place_url || '#'}" target="_blank">${place.place_name}</a>
                        <span style="color:#64748b; font-size:11px; margin-left:4px;">${distText}</span>
                        <div style="color:#64748b; font-size:11px; margin-top:2px;">${place.road_address_name || place.address_name || ''}</div>
                    </div>
                    <button class="btn-select-place" onclick="recalculateForPlace('${place.place_name}', ${place.y}, ${place.x}, '${place.road_address_name || place.address_name}')">
                        👉 이 장소로 계산
                    </button>
                </li>
            `;
        });
        html += `</ul></div>`;
    }

    // 🚌 대중교통 이동 정보 & 막차 케어
    // 사용자 요구사항: "최적장소 추천받기에서는 안내에 출발지부터 목적지까지 걸리는 시간이라는 문구만 적어 그 항목에서 막차는 신경쓰지 말고"
    const sectionTitle = isFixed 
        ? `🚌 약속 장소 [${targetName}] ➡️ 각자의 집(목적지) 귀가 예상 경로 · 막차 별도 확인`
        : `🚌 출발지부터 목적지까지 걸리는 시간`;

    html += `<div style="margin-top:14px;"><b>${sectionTitle}</b>
        <p style="font-size:12px;color:#64748b;margin:8px 0;">API 응답 기준 예상 경로입니다. 약속 날짜·시각별 운행, 실시간 도착·지연 및 막차는 반영되지 않습니다. 추천 장소는 지리적 중심 기준이며 교통시간의 공평성을 최적화한 결과는 아닙니다.</p>`;
    for (const p of roomParticipants) {
        const transitInfo = isFixed
            ? await searchODsayTransit(targetLng, targetLat, p.lng, p.lat)
            : await searchODsayTransit(p.lng, p.lat, targetLng, targetLat);
        if (renderVersion !== transitRenderVersion) return;
        
        // 길찾기 URL: 지정 장소 모드일 때는 모임장소 -> 각자 집으로 귀가하는 경로, 추천 모드일 때는 출발지 -> 모임장소
        const kakaoTransitUrl = isFixed
            ? `https://map.kakao.com/link/to/${encodeURIComponent(p.address)},${p.lat},${p.lng}/from/${encodeURIComponent(targetName)},${targetLat},${targetLng}`
            : `https://map.kakao.com/link/to/${encodeURIComponent(targetName)},${targetLat},${targetLng}/from/${encodeURIComponent(p.address)},${p.lat},${p.lng}`;

        const routeText = isFixed ? `집(${p.address})까지 귀가` : `출발지(${p.address}) ➡️ 목적지(${targetName})`;

        const lastTrainCare = calculateLastTrainMargin(endTime, transitInfo.totalMinutes, transitInfo.transitCount, transitInfo);

        // 네이버 지도 길찾기 URL 생성
        const naverTransitUrl = isFixed
            ? `https://map.naver.com/v5/directions/${targetLng},${targetLat},${encodeURIComponent(targetName)}/${p.lng},${p.lat},${encodeURIComponent(p.address)}/-/transit`
            : `https://map.naver.com/v5/directions/${p.lng},${p.lat},${encodeURIComponent(p.address)}/${targetLng},${targetLat},${encodeURIComponent(targetName)}/-/transit`;

        if (transitInfo.status !== 'ok') {
            html += `<div class="route-card"><b>👤 ${escapeTransitHtml(p.name)}</b>
                <p>${escapeTransitHtml(routeText)}</p>
                <p role="status">⚠️ ${escapeTransitHtml(transitInfo.message)}</p>
                <p>확인되지 않은 소요시간·요금·막차는 표시하지 않습니다.</p>
                <a href="${naverTransitUrl}" target="_blank" rel="noopener noreferrer" class="route-btn">네이버길찾기</a>
                <a href="${kakaoTransitUrl}" target="_blank" rel="noopener noreferrer" class="route-btn">카카오맵</a></div>`;
            continue;
        }

        // 🎯 1. 네이버 지도 형태 가로 타임라인 바 HTML 생성 (시간만 표기하여 짤림 방지)
        let timelineHtml = '';
        if (transitInfo.timelineSegments && transitInfo.timelineSegments.length > 0) {
            timelineHtml += '<div class="transit-timeline-container">';
            transitInfo.timelineSegments.forEach(seg => {
                timelineHtml += `
                    <div class="transit-bar-segment ${seg.cssClass}" style="flex: ${seg.time};" title="${seg.icon} ${seg.time}분 소요">
                        <span>${seg.icon}</span> <span>${seg.label}</span>
                    </div>
                `;
            });
            timelineHtml += '</div>';
        }

        // 🎯 2. 네이버 지도 형태 세로 타임라인 상세 경로 (Step-by-Step) HTML 생성
        let verticalStepsHtml = '';
        if (transitInfo.verticalSteps && transitInfo.verticalSteps.length > 0) {
            verticalStepsHtml += '<div class="vertical-timeline">';
            transitInfo.verticalSteps.forEach(step => {
                if (step.type === 'transit') {
                    verticalStepsHtml += `
                        <div class="v-step-item">
                            <div class="v-step-dot ${step.dotClass}"></div>
                            <div class="v-step-header">
                                <span class="v-transit-badge ${step.badgeClass}">${step.badgeIcon} ${step.badgeText}</span>
                                <span>${step.stationName}</span>
                                ${step.infoTag ? `<span class="v-info-tag">${step.infoTag}</span>` : ''}
                            </div>
                            <div class="v-step-sub">
                                <span class="v-line-box ${step.lineBoxClass}">[${step.lineName}]</span>
                                <span class="v-step-desc">${step.moveDesc}</span>
                            </div>
                        </div>
                    `;
                } else if (step.type === 'end') {
                    verticalStepsHtml += `
                        <div class="v-step-item">
                            <div class="v-step-dot end"></div>
                            <div class="v-step-header">
                                <span style="font-weight:800; font-size:12px;">🚶 도보</span>
                                <span>${step.stationName}</span>
                            </div>
                            <div class="v-step-sub">
                                <span class="v-step-desc">${step.walkDesc}</span>
                            </div>
                        </div>
                    `;
                }
            });
            verticalStepsHtml += '</div>';
        }

        const totalHours = transitInfo.hours || 0;
        const remainMins = transitInfo.remainMinutes || 0;
        const paymentStr = transitInfo.payment == null ? '정보 없음' : `${transitInfo.payment.toLocaleString()}원`;
        const walkTimeStr = transitInfo.totalWalkTime == null ? '도보시간 정보 없음' : `도보 ${transitInfo.totalWalkTime}분`;

        // 🎯 막차 안내 푸터 (오직 '모임장소 직접 정하기(귀가 목적지 입력)' 모드일 때만 노출)
        let lastTrainBlockHtml = '';
        if (isFixed) {
            lastTrainBlockHtml = `
                <div class="last-train-footer">
                    <span style="font-size:12px; color:#334155;">막차 시각: <b style="font-size:13px; color:#0f172a;">확인 필요</b></span>
                    <span class="safe-tag ${lastTrainCare.badgeClass}">${lastTrainCare.badgeText}</span>
                </div>
                <div style="font-size:11.5px; color:#64748b; margin-top:3px;">• ${lastTrainCare.detailText}</div>
                <div style="font-size:10.5px; color:#94a3b8; margin-top:3px; line-height:1.4;">
                    ※ 약속 날짜의 평일·주말·공휴일 시간표, 열차 종착역, 버스 승차 정류장 및 환승 가능 여부를 별도로 확인하세요.
                </div>
            `;
        }

        html += `
            <div class="route-card">
                <!-- 상단 헤더: 참여자 & 지도 바로가기 버튼 -->
                <div class="route-header">
                    <span>👤 <b>${p.name}</b> <span style="font-size:11.5px; color:#64748b;">(${routeText})</span></span>
                    <div style="display:flex; gap:5px;">
                        <a href="${naverTransitUrl}" target="_blank" class="route-btn" style="background:#03C75A; color:white;">
                            네이버길찾기
                        </a>
                        <a href="${kakaoTransitUrl}" target="_blank" class="route-btn">
                            카카오맵
                        </a>
                    </div>
                </div>

                <!-- 🎯 네이버 지도 스타일: 큰 총 소요시간 및 요금/도보 요약 -->
                <div class="route-summary-row">
                    <span class="route-best-badge">응답 내 최소시간</span>
                    <span class="route-total-time">${totalHours > 0 ? `${totalHours}<span>시간 </span>` : ''}${remainMins}<span>분</span></span>
                    <span class="route-meta-info">| 요금 ${paymentStr} | ${walkTimeStr}</span>
                </div>
                
                <!-- 🎯 가로형 컬러 타임라인 바 (시간만 표기) -->
                ${timelineHtml}

                <!-- 🎯 세로형 상세 환승 타임라인 (정류장, 노선 배지, 소요시간) -->
                ${verticalStepsHtml}

                <!-- 막차 및 안심 귀가 안내 푸터 (모드 분기) -->
                ${lastTrainBlockHtml}
            </div>
        `;
    }
    html += `</div>`;

    if (renderVersion !== transitRenderVersion) return;
    document.getElementById('resultContent').innerHTML = html;
}

function focusOnPlace(lat, lng) {
    const pos = new kakao.maps.LatLng(lat, lng);
    map.panTo(pos);
    map.setLevel(4);
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
