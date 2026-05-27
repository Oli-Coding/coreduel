// CoreDuel Game Application Logic - Production Socket.io / SQLite integrated
let socket = null;

// ==================== STATE MANAGEMENT ====================
let userState = {
    id: null,
    name: "Guest",
    email: "",
    level: 1,
    xp: 0,
    xpNeeded: 400,
    coins: 1000,
    streak: 0,
    mathBest: 100,       // Math Elo (starts at 100)
    iqBest: 100,         // IQ Elo (starts at 100)
    elo: 200,            // Combined Global Elo (Math + IQ)
    equippedFrame: 'default',
    equippedTitle: 'Novice Dueler',
    equippedBackground: 'default',
    inventory: ['default', 'Novice Dueler', 'bg-default'],
    passClaims: [],      // Stores 'reg-X' and 'prem-X'
    streakCheckins: [false, false, false, false, false, false, false],
    avatarSeed: "Guest",
    premium: 0,          // 0 = Regular, 1 = Premium
    nameChangesCount: 0,
    selectedTheme: 'default'
};

// Safe helper to set text content
function safeText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// Load state asynchronously from DB/Localstorage
async function loadState() {
    const savedToken = localStorage.getItem('coreduel_jwt_token');
    const authOverlay = document.getElementById('auth-overlay');
    const onboardingOverlay = document.getElementById('onboarding-overlay');
    const onboardingCompleted = localStorage.getItem('coreduel_onboarding_completed') === 'true';

    if (onboardingCompleted) {
        if (onboardingOverlay) onboardingOverlay.classList.remove('active');
    } else {
        if (onboardingOverlay) onboardingOverlay.classList.add('active');
        if (authOverlay) authOverlay.classList.remove('active');
    }
    
    if (savedToken) {
        try {
            const res = await fetch('/api/user/profile', {
                headers: {
                    'Authorization': `Bearer ${savedToken}`
                }
            });
            if (res.ok) {
                const profile = await res.json();
                userState = {
                    ...userState,
                    ...profile,
                    xpNeeded: getXpNeeded(profile.level || 1)
                };
                
                if (authOverlay) authOverlay.classList.remove('active');
                initSocket(savedToken);
                updateUI();
                return;
            }
        } catch (e) {
            console.error("Error loading user profile:", e);
        }
    }
    
    // Fallback to local storage if token missing or invalid
    const savedLocal = localStorage.getItem('coreduel_user_state');
    if (savedLocal) {
        try {
            userState = { ...userState, ...JSON.parse(savedLocal) };
        } catch (e) {}
    }
    
    if (onboardingCompleted) {
        if (authOverlay) authOverlay.classList.add('active');
    }
}

function saveState() {
    localStorage.setItem('coreduel_user_state', JSON.stringify(userState));
    
    const token = localStorage.getItem('coreduel_jwt_token');
    if (token) {
        fetch('/api/user/profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(userState)
        })
        .catch(err => console.error("Error syncing profile with server:", err));
    }
}

function getXpNeeded(level) {
    return level * 400;
}

function addXP(amount) {
    userState.xp += amount;
    let leveledUp = false;
    while (userState.xp >= userState.xpNeeded) {
        userState.xp -= userState.xpNeeded;
        userState.level++;
        userState.xpNeeded = getXpNeeded(userState.level);
        leveledUp = true;
    }
    return leveledUp;
}

// Elo to Rank calculations (Doubled thresholds if Global is active)
function getEloRank(elo, isGlobal = false) {
    const multiplier = isGlobal ? 2 : 1;
    
    if (elo < 100 * multiplier) return { name: "Bronze I", css: "rank-bronze" };
    if (elo < 200 * multiplier) return { name: "Bronze II", css: "rank-bronze" };
    if (elo < 300 * multiplier) return { name: "Bronze III", css: "rank-bronze" };
    if (elo < 450 * multiplier) return { name: "Silber I", css: "rank-silber" };
    if (elo < 600 * multiplier) return { name: "Silber II", css: "rank-silber" };
    if (elo < 750 * multiplier) return { name: "Silber III", css: "rank-silber" };
    if (elo < 950 * multiplier) return { name: "Gold I", css: "rank-gold" };
    if (elo < 1150 * multiplier) return { name: "Gold II", css: "rank-gold" };
    if (elo < 1350 * multiplier) return { name: "Gold III", css: "rank-gold" };
    if (elo < 1600 * multiplier) return { name: "Diamant I", css: "rank-diamant" };
    if (elo < 1850 * multiplier) return { name: "Diamant II", css: "rank-diamant" };
    if (elo < 2100 * multiplier) return { name: "Diamant III", css: "rank-diamant" };
    if (elo < 2600 * multiplier) return { name: "Champion I", css: "rank-champion" };
    if (elo < 3100 * multiplier) return { name: "Champion II", css: "rank-champion" };
    if (elo < 3600 * multiplier) return { name: "Champion III", css: "rank-champion" };
    if (elo < 4600 * multiplier) return { name: "Meister I", css: "rank-master" };
    if (elo < 5600 * multiplier) return { name: "Meister II", css: "rank-master" };
    if (elo < 6600 * multiplier) return { name: "Meister III", css: "rank-master" };
    return { name: "Grandmaster", css: "rank-grandmaster" };
}

// ==================== RENDERING & DOM UPDATES ====================
function updateUI() {
    safeText('header-streak-value', userState.streak + 'd');
    
    const avatarUrl = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${userState.avatarSeed}`;
    const headerAvatar = document.getElementById('header-avatar');
    if (headerAvatar) {
        headerAvatar.src = avatarUrl;
        const headerAvatarContainer = headerAvatar.parentElement;
        if (headerAvatarContainer) {
            headerAvatarContainer.className = 'profile-placeholder';
            if (userState.equippedFrame !== 'default') {
                headerAvatarContainer.classList.add(userState.equippedFrame);
            }
        }
    }
    
    safeText('dash-lvl-title', `Level ${userState.level}`);
    safeText('dash-xp-progress', `${userState.xp.toLocaleString()} / ${userState.xpNeeded.toLocaleString()} XP`);
    
    const xpBar = document.getElementById('dash-xp-bar');
    if (xpBar) {
        const xpPercent = Math.min(100, (userState.xp / userState.xpNeeded) * 100);
        xpBar.style.width = `${xpPercent}%`;
    }
    
    safeText('dash-coins', userState.coins);
    
    // Dashboard displays Global Elo and Global Rank (doubled thresholds)
    const rankInfo = getEloRank(userState.elo, true);
    const badge = document.getElementById('dash-rank-badge');
    if (badge) {
        badge.className = `rank-badge ${rankInfo.css}`;
        badge.textContent = rankInfo.name;
    }
    safeText('dash-elo-progress', `ELO: ${userState.elo}`);
    
    safeText('stat-math-best', userState.mathBest);
    safeText('stat-iq-best', userState.iqBest);
    safeText('shop-coins-val', userState.coins);
    
    // Render Grandmaster background equipped states on Dashboard Card & Profile Modal
    const dashboardCard = document.getElementById('home-dashboard-card');
    const profileModalCard = document.querySelector('#modal-profile .profile-modal');
    const isMasterBg = (userState.equippedBackground === 'bg-master');
    const particlesTemplate = `
        <div class="master-bg-wrapper">
            <div class="shop-bg-particles">
                <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
            </div>
            <div class="master-shimmer-sweep"></div>
            <div class="cosmic-orbit-ring"></div>
        </div>
    `;
    
    [dashboardCard, profileModalCard].forEach(el => {
        if (!el) return;
        const existingParticles = el.querySelector('.master-bg-wrapper');
        if (existingParticles) existingParticles.remove();
        
        if (isMasterBg) {
            el.classList.add('bg-master-equipped');
            el.insertAdjacentHTML('afterbegin', particlesTemplate);
        } else {
            el.classList.remove('bg-master-equipped');
        }
    });
    
    const detailAvatar = document.getElementById('profile-detail-avatar');
    if (detailAvatar) detailAvatar.src = avatarUrl;
    
    const profileDetailAvatarContainer = document.getElementById('modal-avatar-preview');
    if (profileDetailAvatarContainer) {
        profileDetailAvatarContainer.className = 'profile-modal-avatar';
        if (userState.equippedFrame !== 'default') {
            profileDetailAvatarContainer.classList.add(userState.equippedFrame);
        }
    }
    
    safeText('profile-detail-title', userState.equippedTitle);
    
    const detailRank = document.getElementById('profile-detail-rank');
    if (detailRank) {
        detailRank.className = `rank-badge ${rankInfo.css}`;
        detailRank.textContent = rankInfo.name;
    }
    
    safeText('profile-stat-level', `Lvl ${userState.level}`);
    safeText('profile-stat-streak', userState.streak + 'd');
    safeText('profile-stat-coins', userState.coins);
    safeText('profile-stat-elo', `${userState.elo} Elo`);
    
    const usernameEl = document.getElementById('profile-player-username');
    if (usernameEl) usernameEl.textContent = userState.name;
    
    const seedInput = document.getElementById('settings-username-input');
    if (seedInput) seedInput.value = userState.name;
    
    const usernameCostEl = document.getElementById('settings-username-cost');
    if (usernameCostEl) {
        usernameCostEl.textContent = (userState.nameChangesCount || 0) > 0 ? "Cost: 1,000 Coins" : "First change: Free";
    }
    
    // CorePass Premium Header Badging
    const premBadge = document.getElementById('pass-premium-status');
    if (premBadge) {
        if (userState.premium === 1) {
            premBadge.textContent = "Premium Active";
            premBadge.style.background = "linear-gradient(90deg, #facc15, #fbbf24)";
        } else {
            premBadge.textContent = "Get Premium";
            premBadge.style.background = "#facc15";
        }
    }
}

// ==================== SPA ROUTING ====================
const pages = ['home', 'ranking', 'premium', 'pass', 'shop'];

function switchTab(tabId, index) {
    pages.forEach(p => {
        const pageNode = document.getElementById(`page-${p}`);
        if (pageNode) {
            if (p === tabId) pageNode.classList.add('active');
            else pageNode.classList.remove('active');
        }
    });
    
    const bottomTabbar = document.getElementById('bottom-tabbar');
    if (bottomTabbar) {
        const buttons = bottomTabbar.querySelectorAll('.tab-btn');
        buttons.forEach(btn => {
            if (btn.getAttribute('data-tab') === tabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        bottomTabbar.setAttribute('data-active-index', index);
    }
    
    if (tabId === 'ranking') renderLeaderboard();
    else if (tabId === 'pass') renderPass();
    else if (tabId === 'shop') renderShop();
}

// ==================== LEADERBOARD RENDER ====================
let activeLbCategory = 'global';

function renderLeaderboard() {
    const mode = activeLbCategory === 'global' ? 'global' : (activeLbCategory === 'math' ? 'math' : 'iq');
    
    fetch(`/api/leaderboard?mode=${mode}`)
        .then(res => res.json())
        .then(list => {
            const getPodiumScoreLabel = (player) => {
                if (activeLbCategory === 'math') return (player.mathBest || 100) + ' Elo';
                if (activeLbCategory === 'iq') return (player.iqBest || 100) + ' Elo';
                return player.elo + ' Elo';
            };

            const spots = ['first', 'second', 'third'];
            const indices = [0, 1, 2];
            
            indices.forEach(idx => {
                const player = list[idx];
                const spotClass = spots[idx];
                const nameEl = document.querySelector(`.podium-spot.${spotClass} .podium-username`);
                const imgEl = document.querySelector(`.podium-spot.${spotClass} img`);
                const scoreEl = document.querySelector(`.podium-spot.${spotClass} .podium-score`);
                const avatarFrame = document.querySelector(`.podium-spot.${spotClass} .podium-avatar`);
                
                if (player) {
                    if (nameEl) nameEl.textContent = player.name;
                    if (imgEl) imgEl.src = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${player.avatarSeed || player.name}`;
                    if (scoreEl) scoreEl.innerHTML = `<span>${getPodiumScoreLabel(player)}</span>`;
                    if (avatarFrame) {
                        avatarFrame.className = 'podium-avatar';
                        if (player.frame && player.frame !== 'default') avatarFrame.classList.add(player.frame);
                    }
                } else {
                    if (nameEl) nameEl.textContent = "Empty";
                    if (scoreEl) scoreEl.textContent = "-";
                }
            });

            const listContainer = document.getElementById('leaderboard-list');
            if (listContainer) {
                listContainer.innerHTML = '';
                list.slice(0, 5).forEach((player, i) => {
                    renderLeaderboardItem(listContainer, player, i);
                });
            }

            const myIndex = list.findIndex(p => p.name === userState.name);
            const divider = document.getElementById('leaderboard-my-divider');
            const myRowContainer = document.getElementById('leaderboard-my-row');
            
            if (myRowContainer && divider) {
                myRowContainer.innerHTML = '';
                if (myIndex >= 5) {
                    divider.style.display = 'block';
                    myRowContainer.style.display = 'block';
                    renderLeaderboardItem(myRowContainer, list[myIndex], myIndex);
                } else {
                    divider.style.display = 'none';
                    myRowContainer.style.display = 'none';
                }
            }
        })
        .catch(err => console.error("Error fetching leaderboard:", err));
}

function renderLeaderboardItem(container, player, i) {
    const item = document.createElement('div');
    const isMe = (player.name === userState.name);
    
    let bgClass = '';
    if (player.background === 'bg-master' || (isMe && userState.equippedBackground === 'bg-master')) {
        bgClass = 'bg-master-equipped';
    }
    
    item.className = `leaderboard-item ${isMe ? 'me' : ''} ${i === 0 ? 'rank-first' : ''} ${bgClass}`;
    
    const frameClass = (player.frame && player.frame !== 'default') ? player.frame : '';
    // Global ranks get Global doubled boundaries, Math and IQ leaderboards use standard limits
    const isGlobalMode = (activeLbCategory === 'global');
    const eloVal = isGlobalMode ? player.elo : (activeLbCategory === 'math' ? player.mathBest : player.iqBest);
    const rankBadgeInfo = getEloRank(eloVal, isGlobalMode);
    
    const scoreLabel = activeLbCategory === 'math' ? (player.mathBest || 100) + ' Elo'
                     : activeLbCategory === 'iq' ? (player.iqBest || 100) + ' Elo'
                     : player.elo + ' Elo';
    
    let particlesHtml = '';
    if (bgClass === 'bg-master-equipped') {
        particlesHtml = `
            <div class="master-bg-wrapper">
                <div class="shop-bg-particles">
                    <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                    <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                    <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                </div>
                <div class="master-shimmer-sweep"></div>
                <div class="cosmic-orbit-ring"></div>
            </div>
        `;
    }
    
    item.innerHTML = `
        ${particlesHtml}
        <div class="leaderboard-left" style="z-index: 2;">
            <span class="leaderboard-rank">${i === 0 ? '👑' : '#' + (i + 1)}</span>
            <div class="leaderboard-avatar ${frameClass}" style="width: 36px; height: 36px; border-radius: 50%; padding:2px; display:flex; justify-content:center; align-items:center;">
                <img src="https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${player.avatarSeed || player.name}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" alt="Avatar">
            </div>
            <div class="leaderboard-name-container">
                <span class="leaderboard-name">${player.name}</span>
                <span class="leaderboard-title-badge" style="display:flex; flex-direction:column; gap:2px; align-items:flex-start;">
                    <span>${player.title || 'Novice Dueler'}</span>
                    <span class="rank-badge ${rankBadgeInfo.css}" style="font-size:7px; padding:1px 4px; margin-top:2px;">${rankBadgeInfo.name}</span>
                </span>
            </div>
        </div>
        <div class="leaderboard-right" style="z-index: 2;">
            <span class="leaderboard-item-streak">
                <svg viewBox="0 0 24 24" style="width:12px; height:12px;">
                    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"/>
                </svg>
                ${player.streak || 0}d
            </span>
            <span class="leaderboard-score">${scoreLabel}</span>
        </div>
    `;
    
    container.appendChild(item);
}

// ==================== COREPASS DUAL REWARDS ====================
const passRewards = [
    { tier: 1, name: "100 Coins", val: { coins: 100 }, premName: "500 Coins", premVal: { coins: 500 } },
    { tier: 2, name: "200 Level XP", val: { xp: 200 }, premName: "1,000 XP Boost", premVal: { xp: 1000 } },
    { tier: 3, name: "Title: Dueling Scout", val: { title: "Dueling Scout" }, premName: "Title: Core Emperor", premVal: { title: "Core Emperor" } },
    { tier: 4, name: "200 Coins", val: { coins: 200 }, premName: "1,000 Coins", premVal: { coins: 1000 } },
    { tier: 5, name: "Title: Calculus Lord", val: { title: "Calculus Lord" }, premName: "Title: Math God", premVal: { title: "Math God" } },
    { tier: 6, name: "500 Coins", val: { coins: 500 }, premName: "2,000 Coins", premVal: { coins: 2000 } },
    { tier: 7, name: "Title: Brain Master", val: { title: "Brain Master" }, premName: "Title: Mensa Member", premVal: { title: "Mensa Member" } },
    { tier: 8, name: "Neon Yellow Frame", val: { frame: "frame-neon-yellow" }, premName: "Green Matrix Frame", premVal: { frame: "frame-matrix" } },
    { tier: 9, name: "1,000 Coins", val: { coins: 1000 }, premName: "Grandmaster BG", premVal: { background: "bg-master" } },
    { tier: 10, name: "Orange Fire Frame", val: { frame: "frame-fire" }, premName: "Elite Crown Badge", premVal: { title: "Elite Crown Badge" } }
];

function renderPass() {
    const listContainer = document.getElementById('pass-tier-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    const currentTier = userState.level;
    const progressPercent = (userState.xp / userState.xpNeeded) * 100;
    
    const passProgressBar = document.getElementById('pass-progress-bar');
    if (passProgressBar) passProgressBar.style.width = `${progressPercent}%`;
    
    safeText('pass-xp-needed', `${(userState.xpNeeded - userState.xp).toLocaleString()} XP to Tier ${currentTier + 1}`);
    safeText('pass-unlocked-count', `${userState.passClaims.length} / ${passRewards.length * 2}`);
    
    passRewards.forEach(reward => {
        const isUnlocked = reward.tier <= currentTier;
        
        // Regular reward state
        const isRegClaimed = userState.passClaims.includes(`reg-${reward.tier}`);
        let regBtnHtml = '';
        if (isRegClaimed) {
            regBtnHtml = `<button class="pass-reward-claim-btn claimed">Claimed</button>`;
        } else if (isUnlocked) {
            regBtnHtml = `<button class="pass-reward-claim-btn claimable" onclick="claimPassReward('reg', ${reward.tier})">Claim</button>`;
        } else {
            regBtnHtml = `<button class="pass-reward-claim-btn locked">Locked</button>`;
        }
        
        // Premium reward state
        const isPremClaimed = userState.passClaims.includes(`prem-${reward.tier}`);
        let premBtnHtml = '';
        if (isPremClaimed) {
            premBtnHtml = `<button class="pass-reward-claim-btn claimed">Claimed</button>`;
        } else if (isUnlocked) {
            if (userState.premium === 1) {
                premBtnHtml = `<button class="pass-reward-claim-btn claimable" onclick="claimPassReward('prem', ${reward.tier})">Claim</button>`;
            } else {
                premBtnHtml = `<button class="pass-reward-claim-btn locked" onclick="switchTab('premium', 2)">Premium</button>`;
            }
        } else {
            premBtnHtml = `<button class="pass-reward-claim-btn locked">Locked</button>`;
        }
        
        const tierCard = document.createElement('div');
        tierCard.className = `pass-tier-card ${isUnlocked ? 'unlocked' : ''}`;
        
        tierCard.innerHTML = `
            <div class="pass-tier-badge">Tier <span>${reward.tier}</span></div>
            <div class="pass-reward-split">
                <!-- Free Row -->
                <div class="pass-sub-reward regular">
                    <span class="pass-reward-name">${reward.name} (Free)</span>
                    ${regBtnHtml}
                </div>
                <!-- Premium Row -->
                <div class="pass-sub-reward premium">
                    <span class="pass-reward-name">${reward.premName} (Premium)</span>
                    ${premBtnHtml}
                </div>
            </div>
        `;
        listContainer.appendChild(tierCard);
    });
}

window.claimPassReward = function(type, tier) {
    const reward = passRewards.find(r => r.tier === tier);
    if (!reward || tier > userState.level) return;
    
    const claimKey = `${type}-${tier}`;
    if (userState.passClaims.includes(claimKey)) return;
    
    // If premium claim, verify ownership
    if (type === 'prem' && userState.premium !== 1) {
        switchTab('premium', 2);
        return;
    }
    
    userState.passClaims.push(claimKey);
    const rewardVal = (type === 'reg') ? reward.val : reward.premVal;
    
    if (rewardVal.coins) userState.coins += rewardVal.coins;
    if (rewardVal.xp) addXP(rewardVal.xp);
    if (rewardVal.title && !userState.inventory.includes(rewardVal.title)) userState.inventory.push(rewardVal.title);
    if (rewardVal.frame && !userState.inventory.includes(rewardVal.frame)) userState.inventory.push(rewardVal.frame);
    if (rewardVal.background && !userState.inventory.includes(rewardVal.background)) userState.inventory.push(rewardVal.background);
    
    updateUI();
    renderPass();
    saveState();
};

// ==================== SHOP LAYOUT & INSPECTOR SYSTEM ====================
const shopFrames = [
    { id: "frame-fire", name: "Orange Fire Frame", desc: "A spectacular blazing frame for champions.", price: 1000, type: 'frame' },
    { id: "frame-matrix", name: "Green Matrix Frame", desc: "Code rain outline for logical calculation masters.", price: 1500, type: 'frame' },
    { id: "frame-neon-yellow", name: "Glowing Neon", desc: "A vibrant yellow glowing outline.", price: 500, type: 'frame' },
    { id: "default", name: "Standard Frame", desc: "The standard minimalistic grey outline.", price: 0, type: 'frame' }
];

const shopTitles = [
    { id: "Core Emperor", desc: "The ultimate bragging title for supreme thinkers.", price: 1200, type: 'title' },
    { id: "Mensa Member", desc: "A title fit for logical sequence masterminds.", price: 600, type: 'title' },
    { id: "Math God", desc: "Show off your high-speed mental processing.", price: 300, type: 'title' },
    { id: "Novice Dueler", desc: "A clean starting title for trainees.", price: 0, type: 'title' }
];

const shopBackgrounds = [
    { id: "bg-master", name: "Grandmaster Particle BG", desc: "Legendary animated particles floating in brownish gold light.", price: 2000, type: 'background' },
    { id: "bg-default", name: "Default Theme BG", desc: "The standard sleek dark-blue aesthetic.", price: 0, type: 'background' }
];

let activeShopCategory = 'frames';
let inspectItem = null;

function renderShop() {
    const gridContainer = document.getElementById('shop-items-grid');
    if (!gridContainer) return;
    gridContainer.innerHTML = '';
    
    if (activeShopCategory === 'titles' || activeShopCategory === 'backgrounds') {
        gridContainer.className = 'shop-grid titles-list';
        const items = activeShopCategory === 'titles' ? shopTitles : shopBackgrounds;
        
        items.forEach(item => {
            const itemId = item.id;
            const isOwned = userState.inventory.includes(itemId);
            const isEquipped = activeShopCategory === 'titles' ? (userState.equippedTitle === itemId) : (userState.equippedBackground === itemId);
            
            const row = document.createElement('div');
            row.className = `shop-title-row ${isEquipped ? 'equipped' : ''} ${itemId === 'bg-master' ? 'preview-bg-master' : ''}`;
            row.onclick = () => openShopInspect(item);
            
            let rightHtml = '';
            if (isEquipped) {
                rightHtml = `<span class="shop-grid-price-tag active-equip">Equipped</span>`;
            } else if (isOwned) {
                rightHtml = `<span class="shop-grid-price-tag owned">Owned</span>`;
            } else {
                rightHtml = `<span class="shop-grid-price-tag"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" fill="none"/><path d="M12 8v8M9 10h6" stroke="currentColor"/></svg> ${item.price}</span>`;
            }
            
            let particlesHtml = '';
            if (itemId === 'bg-master') {
                particlesHtml = `
                    <div class="master-bg-wrapper">
                        <div class="shop-bg-particles">
                            <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                            <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                            <span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span><span class="sp-spark"></span>
                        </div>
                        <div class="master-shimmer-sweep"></div>
                        <div class="cosmic-orbit-ring"></div>
                    </div>
                `;
            }
            
            row.innerHTML = `
                ${particlesHtml}
                <div style="z-index: 2;">
                    <div class="shop-title-name" style="${itemId === 'bg-master' ? 'color: #facc15;' : ''}">${item.name || item.id}</div>
                    <div class="shop-title-desc">${item.desc}</div>
                </div>
                ${rightHtml}
            `;
            gridContainer.appendChild(row);
        });
        return;
    }
    
    gridContainer.className = 'shop-grid';
    shopFrames.forEach(item => {
        const isOwned = userState.inventory.includes(item.id);
        const isEquipped = userState.equippedFrame === item.id;
        
        const card = document.createElement('div');
        card.className = 'shop-grid-item';
        card.onclick = () => openShopInspect(item);
        
        const previewHtml = `<div class="shop-grid-preview ${item.id}"><img src="https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${userState.avatarSeed}" alt="Avatar"></div>`;
        
        let statusBadge = '';
        if (isEquipped) statusBadge = `<span class="shop-grid-price-tag active-equip">Equipped</span>`;
        else if (isOwned) statusBadge = `<span class="shop-grid-price-tag owned">Owned</span>`;
        else statusBadge = `<span class="shop-grid-price-tag"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" fill="none"/><path d="M12 8v8M9 10h6" stroke="currentColor"/></svg> ${item.price}</span>`;
        
        card.innerHTML = `${previewHtml}<span class="shop-grid-name">${item.name}</span>${statusBadge}`;
        gridContainer.appendChild(card);
    });
}

function openShopInspect(item) {
    inspectItem = item;
    const modal = document.getElementById('modal-shop-inspect');
    if (!modal) return;
    
    const avatarImg = document.getElementById('inspect-avatar-img');
    const avatarPreviewContainer = document.getElementById('inspect-avatar-preview');
    const titleBadge = document.getElementById('inspect-preview-title-badge');
    const priceText = document.getElementById('inspect-item-price');
    const buyBtn = document.getElementById('inspect-buy-btn');
    
    safeText('inspect-item-name', item.name || item.id);
    safeText('inspect-item-desc', item.desc);
    
    if (avatarImg) avatarImg.src = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${userState.avatarSeed}`;
    
    if (avatarPreviewContainer) {
        avatarPreviewContainer.className = 'profile-modal-avatar';
        if (item.type === 'frame') {
            if (item.id !== 'default') avatarPreviewContainer.classList.add(item.id);
        } else {
            if (userState.equippedFrame !== 'default') avatarPreviewContainer.classList.add(userState.equippedFrame);
        }
    }
    
    if (titleBadge) {
        titleBadge.textContent = item.type === 'title' ? item.id : userState.equippedTitle;
    }
    
    const isOwned = userState.inventory.includes(item.id);
    const isEquipped = (item.type === 'frame') ? (userState.equippedFrame === item.id)
                     : (item.type === 'background') ? (userState.equippedBackground === item.id)
                     : (userState.equippedTitle === item.id);
    
    if (priceText) priceText.textContent = item.price.toLocaleString();
    
    if (buyBtn) {
        buyBtn.disabled = false;
        if (isEquipped) {
            buyBtn.textContent = 'Equipped';
            buyBtn.className = 'result-btn claimed';
            buyBtn.onclick = null;
        } else if (isOwned) {
            buyBtn.textContent = 'Equip Item';
            buyBtn.className = 'result-btn';
            buyBtn.onclick = () => {
                equipShopItem(item.type, item.id);
                closeShopInspect();
            };
        } else {
            buyBtn.textContent = 'Purchase';
            buyBtn.className = 'result-btn';
            buyBtn.onclick = () => buyShopInspectItem(item);
        }
    }
    modal.classList.add('active');
}

function closeShopInspect() {
    const modal = document.getElementById('modal-shop-inspect');
    if (modal) modal.classList.remove('active');
    inspectItem = null;
}

function buyShopInspectItem(item) {
    if (userState.coins < item.price) {
        alert("Not enough coins! Play more duels to earn currency.");
        return;
    }
    
    userState.coins -= item.price;
    userState.inventory.push(item.id);
    
    if (item.type === 'frame') userState.equippedFrame = item.id;
    else if (item.type === 'title') userState.equippedTitle = item.id;
    else if (item.type === 'background') userState.equippedBackground = item.id;
    
    updateUI();
    renderShop();
    closeShopInspect();
    saveState();
}

window.equipShopItem = function(type, itemId) {
    if (!userState.inventory.includes(itemId)) return;
    
    if (type === 'frame') userState.equippedFrame = itemId;
    else if (type === 'background') userState.equippedBackground = itemId;
    else userState.equippedTitle = itemId;
    
    updateUI();
    renderShop();
    renderLeaderboard();
    saveState();
};

// ==================== STREAK CHECK-IN SYSTEM ====================
let modalStreak = null;

function renderStreakModal() {
    const streakCalendarGrid = document.getElementById('streak-calendar-grid');
    const streakModalCountDesc = document.getElementById('streak-modal-count-desc');
    const streakClaimBtn = document.getElementById('streak-claim-btn');
    if (!streakCalendarGrid || !streakModalCountDesc || !streakClaimBtn || !modalStreak) return;
    
    streakCalendarGrid.innerHTML = '';
    const activeIndex = userState.streakCheckins.indexOf(false);
    streakModalCountDesc.textContent = `${userState.streak} Day Streak Active!`;
    
    for (let i = 0; i < 7; i++) {
        const slot = document.createElement('div');
        let dayClass = 'streak-day-slot';
        let iconHtml = '';
        
        const isChecked = userState.streakCheckins[i];
        const isActiveToday = (i === activeIndex);
        
        if (isChecked) {
            dayClass += ' checked';
            iconHtml = `<svg class="slot-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;
        } else if (isActiveToday) {
            dayClass += ' active-today';
            iconHtml = `<svg class="slot-icon" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
        } else {
            dayClass += ' locked';
            iconHtml = `<svg class="slot-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/></svg>`;
        }
        
        slot.className = dayClass;
        slot.innerHTML = `
            <span class="streak-day-label">Day ${i + 1}</span>
            ${iconHtml}
            <span class="streak-day-val" style="font-size:10px;">${isChecked ? 'Claimed' : (isActiveToday ? 'Claim!' : 'Locked')}</span>
        `;
        
        if (isActiveToday) slot.addEventListener('click', claimDailyCheckIn);
        streakCalendarGrid.appendChild(slot);
    }
    
    if (activeIndex === -1) {
        streakClaimBtn.textContent = "Weekly Cycle Complete!";
        streakClaimBtn.disabled = true;
        streakClaimBtn.className = "result-btn claimed";
    } else {
        streakClaimBtn.textContent = `Claim Day ${activeIndex + 1} Check-in`;
        streakClaimBtn.disabled = false;
        streakClaimBtn.className = "result-btn";
        streakClaimBtn.onclick = claimDailyCheckIn;
    }
    modalStreak.classList.add('active');
}

function claimDailyCheckIn() {
    const activeIndex = userState.streakCheckins.indexOf(false);
    if (activeIndex === -1) return;
    
    userState.streakCheckins[activeIndex] = true;
    userState.streak++;
    
    const coinReward = 100;
    userState.coins += coinReward;
    
    document.body.style.background = 'radial-gradient(circle at top, #ca8a04 0%, #060a12 100%)';
    setTimeout(() => {
        document.body.style.background = 'var(--bg-gradient)';
    }, 200);
    
    alert(`Day ${activeIndex + 1} checked in successfully! Current Streak: ${userState.streak}d! Reward: +${coinReward} Coins.`);
    
    if (userState.streakCheckins.every(x => x === true)) {
        userState.streakCheckins = [false, false, false, false, false, false, false];
    }
    
    updateUI();
    renderStreakModal();
    saveState();
}

// ==================== RANKED DUELS GAMEPLAY ====================
let compGame = {
    mode: "math",
    active: false,
    queueTimer: null,
    countdownTimer: null,
    gameIntervalId: null,
    timeLeft: 35,
    userScore: 0,
    oppScore: 0,
    oppDetails: null,
    matchId: null,
    isP1: false,
    correctStreak: 0,
    lastCorrectCount: 0,
    lastIncorrectCount: 0
};

function startRankedMatchmaking(mode) {
    if (!socket) {
        alert("Connecting to server... Please wait.");
        return;
    }
    compGame.mode = mode;
    compGame.active = true;
    
    safeText('comp-game-title', mode === "math" ? "Math Ranked Duel" : "IQ Ranked Duel");
    
    const gameCompScreen = document.getElementById('game-competition');
    if (gameCompScreen) gameCompScreen.classList.add('active');
    
    document.getElementById('comp-queue-panel').style.display = 'flex';
    document.getElementById('comp-faceoff-panel').style.display = 'none';
    document.getElementById('comp-battle-panel').style.display = 'none';
    document.getElementById('comp-waiting-panel').style.display = 'none';
    document.getElementById('comp-timer').style.display = 'none';
    
    let secondsLeft = 5;
    const statusText = document.getElementById('comp-queue-status');
    if (statusText) statusText.textContent = `Searching for opponent... (${secondsLeft}s)`;
    
    if (compGame.queueTimer) clearInterval(compGame.queueTimer);
    compGame.queueTimer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft >= 0) {
            if (statusText) statusText.textContent = `Searching for opponent... (${secondsLeft}s)`;
        } else {
            if (statusText) statusText.textContent = `Finding match...`;
        }
    }, 1000);
    
    socket.emit('join_queue', { mode });
}

function cancelMatchmaking() {
    if (compGame.active && document.getElementById('comp-battle-panel').style.display === 'flex') {
        const confirmForfeit = confirm("Are you sure you want to leave this live match? Leaving now counts as a forfeit and you will lose ELO!");
        if (!confirmForfeit) return;
        
        if (socket) {
            socket.emit('forfeit_match', { matchId: compGame.matchId });
        }
    }
    
    compGame.active = false;
    if (compGame.queueTimer) clearInterval(compGame.queueTimer);
    if (compGame.countdownTimer) clearInterval(compGame.countdownTimer);
    if (compGame.gameIntervalId) clearInterval(compGame.gameIntervalId);
    
    if (socket) socket.emit('cancel_queue');
    
    const gameCompScreen = document.getElementById('game-competition');
    if (gameCompScreen) gameCompScreen.classList.remove('active');
    updateUI();
}

function triggerFaceoff() {
    document.getElementById('comp-queue-panel').style.display = 'none';
    document.getElementById('comp-faceoff-panel').style.display = 'flex';
    
    const meCard = document.getElementById('comp-card-me');
    const oppCard = document.getElementById('comp-opponent-card');
    if (meCard && oppCard) {
        meCard.style.animation = 'none';
        oppCard.style.animation = 'none';
        meCard.offsetHeight;
        meCard.style.animation = '';
        oppCard.style.animation = '';
    }
    
    safeText('comp-opp-name', compGame.oppDetails.name);
    
    const oppAvatar = document.getElementById('comp-opp-avatar');
    if (oppAvatar) oppAvatar.src = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${compGame.oppDetails.avatarSeed || compGame.oppDetails.name}`;
    
    const myFaceoffAvatar = document.getElementById('comp-faceoff-my-avatar');
    if (myFaceoffAvatar) myFaceoffAvatar.src = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${userState.avatarSeed}`;
    
    const oppRank = getEloRank(compGame.oppDetails.elo);
    const oppBadge = document.getElementById('comp-faceoff-opp-badge');
    if (oppBadge) {
        oppBadge.className = `rank-badge ${oppRank.css}`;
        oppBadge.textContent = oppRank.name;
    }
    
    // Global Elo is combined and uses global doubled rank boundaries
    const myRank = getEloRank(userState.elo, true);
    const myBadge = document.getElementById('comp-faceoff-my-badge');
    if (myBadge) {
        myBadge.className = `rank-badge ${myRank.css}`;
        myBadge.textContent = myRank.name;
    }
    
    const countdownBar = document.getElementById('comp-faceoff-countdown-bar');
    if (countdownBar) {
        countdownBar.style.transition = 'none';
        countdownBar.style.width = '100%';
        countdownBar.offsetHeight;
        countdownBar.style.transition = 'width 3.5s linear';
        countdownBar.style.width = '0%';
    }
    
    let count = 3;
    const countdownNode = document.getElementById('comp-faceoff-countdown');
    if (countdownNode) countdownNode.textContent = `Starting in ${count}...`;
    
    if (compGame.countdownTimer) clearInterval(compGame.countdownTimer);
    compGame.countdownTimer = setInterval(() => {
        count--;
        if (count <= 0) {
            clearInterval(compGame.countdownTimer);
            if (countdownNode) countdownNode.textContent = "FIGHT!";
        } else {
            if (countdownNode) countdownNode.textContent = `Starting in ${count}...`;
        }
    }, 1000);
}

function handleSocketMatchStart(data) {
    document.getElementById('comp-faceoff-panel').style.display = 'none';
    document.getElementById('comp-battle-panel').style.display = 'flex';
    document.getElementById('comp-waiting-panel').style.display = 'none';
    
    const compTimer = document.getElementById('comp-timer');
    if (compTimer) {
        compTimer.style.display = 'flex';
        compTimer.classList.remove('hurry');
    }
    
    compGame.userScore = 0;
    compGame.oppScore = 0;
    compGame.timeLeft = 35;
    safeText('comp-timer-val', compGame.timeLeft);
    
    safeText('comp-battle-opp-name', compGame.oppDetails.name);
    safeText('comp-score-user', "0 Correct | 0 Wrong");
    safeText('comp-score-opp', "0 Correct | 0 Wrong");
    
    const pbarUser = document.getElementById('comp-pbar-user');
    const pbarOpp = document.getElementById('comp-pbar-opp');
    if (pbarUser) pbarUser.style.width = "0%";
    if (pbarOpp) pbarOpp.style.width = "0%";
    
    if (compGame.gameIntervalId) clearInterval(compGame.gameIntervalId);
    compGame.gameIntervalId = setInterval(() => {
        compGame.timeLeft--;
        safeText('comp-timer-val', compGame.timeLeft);
        if (compGame.timeLeft <= 5 && compTimer) compTimer.classList.add('hurry');
        if (compGame.timeLeft <= 0) clearInterval(compGame.gameIntervalId);
    }, 1000);
    
    renderQuestion(data.q, data.choices);
}

function renderQuestion(questionText, choices) {
    safeText('comp-question', questionText);
    safeText('comp-instruction', compGame.mode === "math" ? "Solve the arithmetic quickly!" : "Find the missing number in the sequence!");
    
    const container = document.getElementById('comp-options-container');
    if (container) {
        container.innerHTML = '';
        choices.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                btn.classList.add('clicked-option');
                const btns = container.querySelectorAll('.option-btn');
                btns.forEach(b => b.disabled = true);
                
                socket.emit('submit_answer', {
                    matchId: compGame.matchId,
                    selectedOption: opt
                });
            });
            container.appendChild(btn);
        });
    }
}

function handleSocketMatchEnd(data) {
    compGame.active = false;
    if (compGame.queueTimer) clearInterval(compGame.queueTimer);
    if (compGame.countdownTimer) clearInterval(compGame.countdownTimer);
    if (compGame.gameIntervalId) clearInterval(compGame.gameIntervalId);
    
    const gameCompScreen = document.getElementById('game-competition');
    if (gameCompScreen) gameCompScreen.classList.remove('active');
    
    userState.elo = Math.max(0, userState.elo + data.eloChange);
    if (compGame.mode === 'math') userState.mathBest = Math.max(0, userState.mathBest + data.eloChange);
    if (compGame.mode === 'iq') userState.iqBest = Math.max(0, userState.iqBest + data.eloChange);
    
    userState.coins += data.coinsGained;
    const leveledUp = addXP(data.xpGained);
    
    const modalTitle = document.getElementById('result-status-title');
    if (modalTitle) modalTitle.textContent = leveledUp ? "Level Up!" : (data.result === "Victory" ? "Victory!" : (data.result === "Defeat" ? "Defeat!" : "Draw!"));
    
    const modeLabel = compGame.mode === "math" ? "Math Duel" : "IQ Duel";
    safeText('result-game-desc', data.result === "Victory"
        ? `You won in ranked ${modeLabel}!`
        : (data.result === "Defeat" ? `You were defeated in ranked ${modeLabel}.` : `Match ended in a draw.`));
        
    const coinsVal = document.getElementById('result-coins');
    if (coinsVal) {
        coinsVal.innerHTML = `
            <span style="color: ${data.eloChange >= 0 ? '#10b981' : '#ef4444'}; font-weight:800; font-size:18px;">${data.eloChange >= 0 ? '+' : ''}${data.eloChange} Elo</span>
            <div style="font-size:11px; color:var(--color-text-secondary); text-transform:uppercase; margin-top:2px;">Rank Rating</div>
            <div style="color:var(--color-accent); font-weight:700; margin-top:8px; font-size:14px;">+50 Coins | +100 XP</div>
        `;
    }
    
    const rematchBtn = document.getElementById('result-rematch-btn');
    if (rematchBtn) {
        if (data.isDoubleOrNothing) {
            rematchBtn.style.display = 'none';
        } else {
            rematchBtn.style.display = 'block';
            rematchBtn.onclick = () => {
                const modalResult = document.getElementById('modal-result');
                if (modalResult) modalResult.classList.remove('active');
                
                socket.emit('rematch_double_or_nothing', {
                    matchId: data.matchId,
                    eloChange: data.eloChange
                });
            };
        }
    }
    
    const modalResult = document.getElementById('modal-result');
    if (modalResult) modalResult.classList.add('active');
    
    const savedToken = localStorage.getItem('coreduel_jwt_token');
    if (savedToken) {
        fetch('/api/user/profile', {
            headers: { 'Authorization': `Bearer ${savedToken}` }
        })
        .then(res => res.json())
        .then(profile => {
            userState = { ...userState, ...profile, xpNeeded: getXpNeeded(profile.level) };
            updateUI();
            renderLeaderboard();
        })
        .catch(err => console.error("Error refreshing state:", err));
    } else {
        updateUI();
    }
}

// ==================== PROFILE & SETTINGS MODALS ====================
let modalProfile = null;
let modalSettings = null;

function showProfileModal() {
    updateUI();
    if (modalProfile) modalProfile.classList.add('active');
}

function showSettingsModal() {
    updateUI();
    if (modalProfile) modalProfile.classList.remove('active');
    if (modalSettings) modalSettings.classList.add('active');
}

async function handleNameChange() {
    const nameInput = document.getElementById('settings-username-input');
    if (!nameInput) return;
    const newName = nameInput.value.trim();
    if (!newName) {
        alert("Please enter a valid display name.");
        return;
    }
    
    const cost = (userState.nameChangesCount || 0) > 0 ? 1000 : 0;
    if (userState.coins < cost) {
        alert(`Insufficient coins. Changing your name now costs 1,000 Coins.`);
        return;
    }
    
    userState.name = newName;
    userState.coins -= cost;
    userState.nameChangesCount = (userState.nameChangesCount || 0) + 1;
    
    updateUI();
    saveState();
    alert("Username successfully updated!");
}

// ==================== APPLE TAB GESTURE NAVIGATION ====================
let dragTracker = {
    isDragging: false,
    startX: 0,
    deltaX: 0,
    activeIndex: 0,
    tabWidth: 0,
    sliderInitialOffset: 0
};

function setupSwipeGestures() {
    const tabbar = document.getElementById('bottom-tabbar');
    if (!tabbar) return;
    
    tabbar.addEventListener('mousedown', onDragStart);
    tabbar.addEventListener('touchstart', onDragStart, { passive: true });
    
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('touchmove', onDragMove, { passive: false });
    
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchend', onDragEnd);
}

function onDragStart(e) {
    const tabbar = document.getElementById('bottom-tabbar');
    if (!tabbar) return;
    const slider = tabbar.querySelector('.tab-slider');
    if (!slider) return;
    
    dragTracker.isDragging = true;
    dragTracker.startX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    dragTracker.deltaX = 0;
    dragTracker.activeIndex = parseInt(tabbar.getAttribute('data-active-index') || "0");
    dragTracker.tabWidth = (tabbar.offsetWidth - 20) / 5; // Divided by 5
    dragTracker.sliderInitialOffset = dragTracker.activeIndex * dragTracker.tabWidth;
    
    slider.classList.add('no-transition');
}

function onDragMove(e) {
    if (!dragTracker.isDragging) return;
    
    const tabbar = document.getElementById('bottom-tabbar');
    if (!tabbar) return;
    const slider = tabbar.querySelector('.tab-slider');
    if (!slider) return;
    
    const x = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    const deltaX = x - dragTracker.startX;
    dragTracker.deltaX = deltaX;
    let newOffset = dragTracker.sliderInitialOffset + deltaX;
    
    const maxOffset = dragTracker.tabWidth * 4;
    newOffset = Math.max(0, Math.min(maxOffset, newOffset));
    
    const dragRatio = Math.min(1, Math.abs(deltaX) / 120);
    const scaleX = 1 + (dragRatio * 0.35);
    const scaleY = 1 - (dragRatio * 0.15);
    const skew = -deltaX * 0.08;
    const clampedSkew = Math.max(-12, Math.min(12, skew));
    
    slider.classList.add('dragging');
    slider.style.transform = `translateX(${newOffset}px) scale(${scaleX}, ${scaleY}) skewX(${clampedSkew}deg)`;
}

function onDragEnd() {
    if (!dragTracker.isDragging) return;
    dragTracker.isDragging = false;
    
    const tabbar = document.getElementById('bottom-tabbar');
    if (!tabbar) return;
    const slider = tabbar.querySelector('.tab-slider');
    if (!slider) return;
    
    slider.classList.remove('dragging', 'no-transition');
    
    if (Math.abs(dragTracker.deltaX) < 15) {
        slider.style.transform = '';
        return;
    }
    
    const currentTransform = slider.style.transform;
    let currentOffset = 0;
    const match = currentTransform.match(/translateX\(([^)]+)px\)/);
    if (match) currentOffset = parseFloat(match[1]);
    
    const closestIndex = Math.round(currentOffset / dragTracker.tabWidth);
    const targetTab = pages[closestIndex];
    
    slider.style.transform = '';
    switchTab(targetTab, closestIndex);
}

// ==================== COMBO EFFECTS HELPER ====================
function triggerComboEffect(streak) {
    if (streak < 2) return;
    
    const playArea = document.getElementById('comp-battle-panel');
    if (!playArea) return;
    
    // Remove existing combo badge if any
    const existing = playArea.querySelector('.combo-floating-badge');
    if (existing) existing.remove();
    
    const badge = document.createElement('div');
    badge.className = 'combo-floating-badge';
    
    if (streak === 2) {
        badge.innerHTML = `<span class="combo-title">🔥 DOUBLE COMBO!</span><span class="combo-sub">x2 Streak</span>`;
        badge.classList.add('c-double');
    } else {
        badge.innerHTML = `<span class="combo-title">⚡ BRAIN ON FIRE! ⚡</span><span class="combo-sub">x${streak} Streak</span>`;
        badge.classList.add('c-triple');
        
        // Add screen shake effect
        playArea.classList.add('screen-shake');
        setTimeout(() => playArea.classList.remove('screen-shake'), 500);
    }
    
    playArea.appendChild(badge);
    
    // Auto remove after animation ends
    setTimeout(() => {
        if (badge.parentNode) badge.remove();
    }, 1500);
}

// ==================== WEBSOCKET INTEGRATION ====================
function initSocket(token) {
    if (socket) return;
    
    socket = io();
    socket.emit('auth_handshake', token);
    
    socket.on('match_found', (data) => {
        if (compGame.queueTimer) clearInterval(compGame.queueTimer);
        compGame.matchId = data.matchId;
        compGame.isP1 = (data.p1.name === userState.name || data.p1.avatarSeed === userState.avatarSeed);
        compGame.oppDetails = compGame.isP1 ? data.p2 : data.p1;
        triggerFaceoff();
    });
    
    socket.on('match_start', (data) => {
        compGame.correctStreak = 0;
        compGame.lastCorrectCount = 0;
        compGame.lastIncorrectCount = 0;
        handleSocketMatchStart(data);
    });
    
    socket.on('question_next', (data) => {
        renderQuestion(data.q, data.choices);
    });
    
    socket.on('score_update', (data) => {
        const myScore = compGame.isP1 ? data.p1Score : data.p2Score;
        const myCorrect = compGame.isP1 ? data.p1Correct : data.p2Correct;
        const myIncorrect = compGame.isP1 ? data.p1Incorrect : data.p2Incorrect;
        
        const oppScore = compGame.isP1 ? data.p2Score : data.p1Score;
        const oppCorrect = compGame.isP1 ? data.p2Correct : data.p1Correct;
        const oppIncorrect = compGame.isP1 ? data.p2Incorrect : data.p1Incorrect;
        
        // Check local correct answer streak
        if (myCorrect > (compGame.lastCorrectCount || 0)) {
            compGame.correctStreak++;
            triggerComboEffect(compGame.correctStreak);
        } else if (myIncorrect > (compGame.lastIncorrectCount || 0)) {
            compGame.correctStreak = 0;
        }
        compGame.lastCorrectCount = myCorrect || 0;
        compGame.lastIncorrectCount = myIncorrect || 0;
        
        compGame.userScore = myScore;
        compGame.oppScore = oppScore;
        
        // Show correct vs incorrect in scores HUD
        safeText('comp-score-user', `${myCorrect || 0} Correct | ${myIncorrect || 0} Wrong`);
        safeText('comp-score-opp', `${oppCorrect || 0} Correct | ${oppIncorrect || 0} Wrong`);
        
        const pbarUser = document.getElementById('comp-pbar-user');
        const pbarOpp = document.getElementById('comp-pbar-opp');
        if (pbarUser) pbarUser.style.width = `${(myScore / 10) * 100}%`;
        if (pbarOpp) pbarOpp.style.width = `${(oppScore / 10) * 100}%`;
    });
    
    socket.on('answer_wrong', (data) => {
        const container = document.getElementById('comp-options-container');
        if (container) {
            const btns = container.querySelectorAll('.option-btn');
            btns.forEach(btn => {
                btn.disabled = true;
                if (parseInt(btn.textContent) === data.correctVal) {
                    btn.classList.add('correct');
                }
            });
            
            const clickedBtn = container.querySelector('.option-btn.clicked-option');
            if (clickedBtn && parseInt(clickedBtn.textContent) !== data.correctVal) {
                clickedBtn.classList.add('wrong');
            }
            
            document.body.style.background = 'radial-gradient(circle at top, #3b0712 0%, #060a12 100%)';
            setTimeout(() => {
                document.body.style.background = 'var(--bg-gradient)';
            }, 150);
        }
    });
    
    // Trigger wait screen when this player finishes 10 questions first
    socket.on('player_finished', () => {
        document.getElementById('comp-battle-panel').style.display = 'none';
        document.getElementById('comp-waiting-panel').style.display = 'flex';
        safeText('waiting-my-score', `${compGame.userScore}/10`);
    });
    
    socket.on('match_end', (data) => {
        handleSocketMatchEnd(data);
    });
}

// ==================== AUTH SUBMITS ====================
function onLoginSuccess(data) {
    localStorage.setItem('coreduel_jwt_token', data.token);
    userState = {
        ...userState,
        ...data.user,
        xpNeeded: getXpNeeded(data.user.level)
    };
    
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.classList.remove('active');
    
    initSocket(data.token);
    updateUI();
    renderLeaderboard();
}

async function simulateSocialLogin(provider) {
    const seed = provider + "User_" + Math.floor(Math.random() * 9000 + 1000);
    const email = `${seed.toLowerCase()}@social.coreduel`;
    const password = "social_secure_password_1337";
    const name = seed;
    
    alert(`Simulating ${provider} Secure OAuth Authentication...`);
    
    try {
        let res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, avatarSeed: seed })
        });
        let data = await res.json();
        
        if (!res.ok) {
            res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            data = await res.json();
        }
        
        if (res.ok) {
            onLoginSuccess(data);
        } else {
            alert("Social Authentication Simulation failed: " + data.error);
        }
    } catch (e) {
        console.error(e);
        alert("Network error simulating social login");
    }
}

// ==================== BINDING TRIGGERS ====================
function bindAllTriggers() {
    const cardMath = document.getElementById('card-math-duel');
    if (cardMath) cardMath.onclick = () => startRankedMatchmaking("math");
    
    const cardIq = document.getElementById('card-iq-duel');
    if (cardIq) cardIq.onclick = () => startRankedMatchmaking("iq");
    
    const cardComp = document.getElementById('card-competitions');
    const modalTournament = document.getElementById('modal-tournament');
    if (cardComp && modalTournament) cardComp.onclick = () => modalTournament.classList.add('active');
    
    const tournamentCloseBtn = document.getElementById('tournament-close-btn');
    if (tournamentCloseBtn && modalTournament) tournamentCloseBtn.onclick = () => modalTournament.classList.remove('active');
    
    const streakTrigger = document.getElementById('streak-trigger');
    if (streakTrigger) streakTrigger.onclick = () => renderStreakModal();
    
    const streakCloseBtn = document.getElementById('streak-close-btn');
    if (streakCloseBtn) {
        streakCloseBtn.onclick = () => {
            const modalStreak = document.getElementById('modal-streak');
            if (modalStreak) modalStreak.classList.remove('active');
        };
    }
    
    const profileTrigger = document.getElementById('profile-trigger');
    if (profileTrigger) profileTrigger.onclick = showProfileModal;
    
    const profileCloseBtn = document.getElementById('profile-close-btn');
    if (profileCloseBtn) {
        profileCloseBtn.onclick = () => {
            if (modalProfile) modalProfile.classList.remove('active');
        };
    }
    
    // Large Settings Trigger
    const openSettingsBtn = document.getElementById('open-settings-modal-btn');
    if (openSettingsBtn) openSettingsBtn.onclick = showSettingsModal;
    
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    if (settingsCloseBtn) {
        settingsCloseBtn.onclick = () => {
            if (modalSettings) modalSettings.classList.remove('active');
        };
    }
    
    // Settings name changes
    const settingsUsernameBtn = document.getElementById('settings-username-btn');
    if (settingsUsernameBtn) {
        settingsUsernameBtn.onclick = handleNameChange;
    }
    
    const compCloseTrigger = document.getElementById('comp-close-trigger');
    if (compCloseTrigger) compCloseTrigger.onclick = cancelMatchmaking;
    
    const compCancelBtn = document.getElementById('comp-cancel-btn');
    if (compCancelBtn) compCancelBtn.onclick = cancelMatchmaking;
    
    const resultActionBtn = document.getElementById('result-action-btn');
    if (resultActionBtn) {
        resultActionBtn.onclick = () => {
            const modalResult = document.getElementById('modal-result');
            if (modalResult) modalResult.classList.remove('active');
            updateUI();
        };
    }
    
    const shopCategoriesTabbar = document.getElementById('shop-categories-tabbar');
    if (shopCategoriesTabbar) {
        shopCategoriesTabbar.querySelectorAll('.shop-tab').forEach(tabBtn => {
            tabBtn.onclick = () => {
                shopCategoriesTabbar.querySelectorAll('.shop-tab').forEach(b => b.classList.remove('active'));
                tabBtn.classList.add('active');
                activeShopCategory = tabBtn.getAttribute('data-shop-cat');
                renderShop();
            };
        });
    }
    
    const lbCategoriesTabbar = document.getElementById('leaderboard-categories-tabbar');
    if (lbCategoriesTabbar) {
        lbCategoriesTabbar.querySelectorAll('.lb-tab').forEach(tabBtn => {
            tabBtn.onclick = () => {
                lbCategoriesTabbar.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
                tabBtn.classList.add('active');
                activeLbCategory = tabBtn.getAttribute('data-lb-cat');
                renderLeaderboard();
            };
        });
    }
    
    const inspectCloseBtn = document.getElementById('inspect-close-btn');
    if (inspectCloseBtn) inspectCloseBtn.onclick = closeShopInspect;
    
    // Auth Forms Switch
    const switchToRegister = document.getElementById('switch-to-register');
    const switchToLogin = document.getElementById('switch-to-login');
    const authLoginForm = document.getElementById('auth-login-form');
    const authRegisterForm = document.getElementById('auth-register-form');
    
    if (switchToRegister && authLoginForm && authRegisterForm) {
        switchToRegister.onclick = () => {
            authLoginForm.classList.remove('active');
            authRegisterForm.classList.add('active');
        };
    }
    if (switchToLogin && authLoginForm && authRegisterForm) {
        switchToLogin.onclick = () => {
            authRegisterForm.classList.remove('active');
            authLoginForm.classList.add('active');
        };
    }
    
    // Auth Form Submits
    if (authLoginForm) {
        authLoginForm.onsubmit = async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                if (res.ok) onLoginSuccess(data);
                else alert(data.error || "Login failed");
            } catch (err) {
                console.error(err);
                alert("Network error logging in");
            }
        };
    }
    
    if (authRegisterForm) {
        authRegisterForm.onsubmit = async (e) => {
            e.preventDefault();
            const name = document.getElementById('register-name').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            
            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password, avatarSeed: name })
                });
                const data = await res.json();
                if (res.ok) {
                    onLoginSuccess({
                        token: data.token,
                        user: {
                            ...data.user,
                            elo: 200,
                            mathBest: 100,
                            iqBest: 100,
                            coins: 1000,
                            level: 1,
                            xp: 0,
                            streak: 0,
                            equippedFrame: 'default',
                            equippedTitle: 'Novice Dueler',
                            equippedBackground: 'default',
                            inventory: ['default', 'Novice Dueler', 'bg-default'],
                            passClaims: [],
                            streakCheckins: [false, false, false, false, false, false, false]
                        }
                    });
                } else alert(data.error || "Registration failed");
            } catch (err) {
                console.error(err);
                alert("Network error registering");
            }
        };
    }
    
    // Social Buttons
    const googleBtn = document.getElementById('social-google-btn');
    const appleBtn = document.getElementById('social-apple-btn');
    if (googleBtn) googleBtn.onclick = () => simulateSocialLogin("Google");
    if (appleBtn) appleBtn.onclick = () => simulateSocialLogin("Apple");
    
    // Purchase premium simulated button
    const buyPremiumBtn = document.getElementById('buy-premium-action-btn');
    if (buyPremiumBtn) {
        buyPremiumBtn.onclick = () => {
            userState.premium = 1;
            updateUI();
            renderPass();
            saveState();
            alert("Premium Activated! Enjoy exclusive rewards and VIP highlights!");
        };
    }
    
    // Pass Get Premium trigger (sends user to premium tab)
    const passPremiumStatus = document.getElementById('pass-premium-status');
    if (passPremiumStatus) {
        passPremiumStatus.onclick = () => {
            switchTab('premium', 2);
        };
    }
    
    // Settings logout button
    const logoutBtn = document.getElementById('settings-logout-btn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            localStorage.removeItem('coreduel_jwt_token');
            alert("Logged out successfully.");
            location.reload();
        };
    }
    
    // Settings delete account button
    const deleteBtn = document.getElementById('settings-delete-btn');
    if (deleteBtn) {
        deleteBtn.onclick = () => {
            const doubleCheck = confirm("WARNING: Are you sure you want to permanently delete your account? This action is irreversible!");
            if (doubleCheck) {
                localStorage.removeItem('coreduel_jwt_token');
                alert("Account deleted.");
                location.reload();
            }
        };
    }
    
    window.onclick = (e) => {
        const modalStreak = document.getElementById('modal-streak');
        const modalTournament = document.getElementById('modal-tournament');
        const modalInspect = document.getElementById('modal-shop-inspect');
        const modalResult = document.getElementById('modal-result');
        if (e.target === modalProfile) modalProfile.classList.remove('active');
        if (e.target === modalStreak) modalStreak.classList.remove('active');
        if (e.target === modalTournament) modalTournament.classList.remove('active');
        if (e.target === modalResult) modalResult.classList.remove('active');
        if (e.target === modalSettings) modalSettings.classList.remove('active');
        if (e.target === modalInspect) closeShopInspect();
    };
    
    const bottomTabbar = document.getElementById('bottom-tabbar');
    if (bottomTabbar) {
        bottomTabbar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                const tab = btn.getAttribute('data-tab');
                const idx = parseInt(btn.getAttribute('data-index') || "0");
                switchTab(tab, idx);
            };
        });
    }
}

// ==================== ONBOARDING FLOW ====================
let onboardingCurrentSlide = 0;
let onboardingSurveyChoice = null;

function setupOnboardingListeners() {
    const onboardingOverlay = document.getElementById('onboarding-overlay');
    if (!onboardingOverlay) return;

    // Survey option selection
    const surveyOptions = onboardingOverlay.querySelectorAll('.survey-option-btn');
    surveyOptions.forEach(btn => {
        btn.onclick = () => {
            surveyOptions.forEach(opt => opt.classList.remove('selected'));
            btn.classList.add('selected');
            onboardingSurveyChoice = btn.getAttribute('data-choice');
        };
    });

    const slides = onboardingOverlay.querySelectorAll('.onboarding-slide');
    const dots = onboardingOverlay.querySelectorAll('.onboarding-dots .dot');
    const nextBtn = document.getElementById('onboarding-next-btn');
    const skipBtn = document.getElementById('onboarding-skip-btn');

    function showSlide(index) {
        slides.forEach((slide, idx) => {
            if (idx === index) {
                slide.classList.add('active');
            } else {
                slide.classList.remove('active');
            }
        });

        dots.forEach((dot, idx) => {
            if (idx === index) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });

        onboardingCurrentSlide = index;

        // Change button text on the last slide
        if (nextBtn) {
            if (index === slides.length - 1) {
                nextBtn.textContent = 'Enter Arena';
            } else {
                nextBtn.textContent = 'Next';
            }
        }
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            // Slide 1 is the survey slide
            if (onboardingCurrentSlide === 1 && !onboardingSurveyChoice) {
                alert('Please select an option to continue!');
                return;
            }

            if (onboardingCurrentSlide < slides.length - 1) {
                showSlide(onboardingCurrentSlide + 1);
            } else {
                completeOnboarding();
            }
        };
    }

    if (skipBtn) {
        skipBtn.onclick = () => {
            completeOnboarding();
        };
    }

    function completeOnboarding() {
        localStorage.setItem('coreduel_onboarding_completed', 'true');
        if (onboardingSurveyChoice) {
            localStorage.setItem('coreduel_onboarding_survey', onboardingSurveyChoice);
        }
        onboardingOverlay.classList.remove('active');
        
        // After onboarding completes, show auth if not logged in
        const savedToken = localStorage.getItem('coreduel_jwt_token');
        const authOverlay = document.getElementById('auth-overlay');
        if (!savedToken && authOverlay) {
            authOverlay.classList.add('active');
        }
    }
}

// ==================== APP INITIALIZATION ====================
function init() {
    modalProfile = document.getElementById('modal-profile');
    modalStreak = document.getElementById('modal-streak');
    modalSettings = document.getElementById('modal-settings');
    setupOnboardingListeners();
    loadState();
    bindAllTriggers();
    setupSwipeGestures();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
