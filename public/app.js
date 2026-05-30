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
        el.classList.remove('bg-master-equipped');
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
    if (usernameEl) {
        usernameEl.textContent = userState.name;
        if (userState.premium === 2) {
            usernameEl.classList.add('vip-shimmer');
        } else {
            usernameEl.classList.remove('vip-shimmer');
        }
    }
    
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
            premBadge.textContent = "Gold Pass";
            premBadge.style.background = "linear-gradient(90deg, #facc15, #fbbf24)";
        } else if (userState.premium === 2) {
            premBadge.textContent = "Ultimate Active";
            premBadge.style.background = "linear-gradient(90deg, #8b5cf6, #ec4899, #facc15)";
        } else {
            premBadge.textContent = "Get Premium";
            premBadge.style.background = "#facc15";
        }
    }

    // Toggle Simulated Ad Banner based on premium status (Ultimate Deal = Ad-free)
    const adBanner = document.getElementById('simulated-ad-banner');
    if (adBanner) {
        if (userState.premium === 2) {
            adBanner.style.display = 'none';
        } else {
            adBanner.style.display = 'flex';
        }
    }

    // Update Premium Tab Option Cards Active States
    const buyLiteBtn = document.getElementById('buy-premium-lite-btn');
    const buyCosmicBtn = document.getElementById('buy-premium-cosmic-btn');
    const cardLite = document.getElementById('prem-card-lite');
    const cardCosmic = document.getElementById('prem-card-cosmic');

    if (buyLiteBtn && cardLite) {
        if (userState.premium === 1) {
            buyLiteBtn.textContent = "Active";
            buyLiteBtn.disabled = true;
            buyLiteBtn.style.opacity = '0.6';
            cardLite.style.opacity = '0.9';
        } else if (userState.premium === 2) {
            buyLiteBtn.textContent = "Pass Unlocked";
            buyLiteBtn.disabled = true;
            buyLiteBtn.style.opacity = '0.4';
            cardLite.style.opacity = '0.5';
        } else {
            buyLiteBtn.textContent = "Activate Pass";
            buyLiteBtn.disabled = false;
            buyLiteBtn.style.opacity = '1';
            cardLite.style.opacity = '0.75';
        }
    }

    if (buyCosmicBtn && cardCosmic) {
        if (userState.premium === 2) {
            buyCosmicBtn.textContent = "ACTIVE";
            buyCosmicBtn.disabled = true;
            buyCosmicBtn.style.background = '#475569';
            buyCosmicBtn.style.animation = 'none';
            buyCosmicBtn.style.boxShadow = 'none';
            cardCosmic.style.border = '2px solid #475569';
            cardCosmic.style.transform = 'none';
        } else {
            buyCosmicBtn.textContent = "UNLOCK COSMIC DEAL";
            buyCosmicBtn.disabled = false;
            // Background is defined in CSS, so just make sure style overrides are reset
            buyCosmicBtn.style.background = '';
            buyCosmicBtn.style.animation = '';
            buyCosmicBtn.style.boxShadow = '';
            cardCosmic.style.border = '';
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

function viewBackgroundInShop() {
    activeShopCategory = 'backgrounds';
    
    const shopCategoriesTabbar = document.getElementById('shop-categories-tabbar');
    if (shopCategoriesTabbar) {
        shopCategoriesTabbar.querySelectorAll('.shop-tab').forEach(b => {
            if (b.getAttribute('data-shop-cat') === 'backgrounds') b.classList.add('active');
            else b.classList.remove('active');
        });
    }

    switchTab('shop', 4);
    
    setTimeout(() => {
        const item = document.querySelector('.preview-bg-master');
        if (item) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.style.boxShadow = '0 0 30px rgba(139, 92, 246, 0.8)';
            item.style.borderColor = '#8b5cf6';
            setTimeout(() => {
                item.style.boxShadow = '';
                item.style.borderColor = '';
            }, 2000);
        }
    }, 200);
}

// ==================== LEADERBOARD RENDER ====================
let activeLbCategory = 'global';
let activeLbSubcategory = 'global_all';

function renderLeaderboard() {
    const mode = activeLbCategory === 'global' ? 'global' : (activeLbCategory === 'math' ? 'math' : 'iq');
    const subTabbar = document.getElementById('leaderboard-subtabs');
    const podiumContainer = document.querySelector('.podium-container');
    const listContainer = document.getElementById('leaderboard-list');
    
    // Sub-tabbar is ALWAYS visible
    if (subTabbar) subTabbar.style.display = 'flex';

    // Handle podium visibility
    if (activeLbSubcategory !== 'global_all') {
        if (podiumContainer) podiumContainer.style.display = 'none';
    } else {
        if (podiumContainer) podiumContainer.style.display = 'flex';
    }

    // Toggle sub-tab button styling
    if (subTabbar) {
        subTabbar.querySelectorAll('.lb-subtab').forEach(btn => {
            if (btn.getAttribute('data-lb-sub') === activeLbSubcategory) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    const divider = document.getElementById('leaderboard-my-divider');
    const myRow = document.getElementById('leaderboard-my-row');

    // Filter by Friends
    if (activeLbSubcategory === 'global_friends') {
        if (listContainer) {
            listContainer.innerHTML = '';
            userState.friends = userState.friends || [];
            
            // Build temporary friends list with user included
            const fullList = [
                { name: userState.name, elo: userState.elo, streak: userState.streak, title: userState.equippedTitle, frame: userState.equippedFrame, background: userState.equippedBackground, avatarSeed: userState.avatarSeed, premium: userState.premium, mathBest: userState.mathBest, iqBest: userState.iqBest },
                ...userState.friends
            ];
            
            // Sort depending on selected Category
            if (activeLbCategory === 'math') {
                fullList.sort((a, b) => (b.mathBest || 100) - (a.mathBest || 100));
            } else if (activeLbCategory === 'iq') {
                fullList.sort((a, b) => (b.iqBest || 100) - (a.iqBest || 100));
            } else {
                fullList.sort((a, b) => b.elo - a.elo);
            }
            
            if (userState.friends.length === 0) {
                listContainer.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px; text-align:center; gap:12px;">
                        <span style="font-size:32px;">👥</span>
                        <p style="font-size:12px; color:var(--color-text-secondary); margin:0;">You haven't added any friends yet!</p>
                        <button class="result-btn" id="empty-friends-add-btn" style="max-width:180px; padding:8px 16px; font-size:11px; background:var(--color-accent); color:#000; font-weight:800; border:none; border-radius:8px; cursor:pointer;">Add Friend</button>
                    </div>
                `;
                const emptyBtn = document.getElementById('empty-friends-add-btn');
                if (emptyBtn) {
                    emptyBtn.onclick = () => {
                        const m = document.getElementById('modal-friends');
                        if (m) m.classList.add('active');
                        renderFriendsList();
                    };
                }
            } else {
                // Show friends list (showing top 3 elements or all friends since it is filtered)
                fullList.forEach((player, i) => {
                    renderLeaderboardItem(listContainer, player, i);
                });
            }
        }
        
        if (divider) divider.style.display = 'none';
        if (myRow) myRow.style.display = 'none';
        return;
    }

    // Filter by Clubs
    if (activeLbSubcategory === 'global_clubs') {
        if (listContainer) {
            listContainer.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px; text-align:center; gap:12px;">
                    <span style="font-size:32px;">🛡️</span>
                    <h4 style="font-size:14px; margin:0; color:#a78bfa;">Clubs Coming in Season 2</h4>
                    <p style="font-size:11px; color:var(--color-text-secondary); margin:0; max-width:240px;">Create alliances, complete daily math challenges together, and battle in Club Leagues soon!</p>
                </div>
            `;
        }
        if (divider) divider.style.display = 'none';
        if (myRow) myRow.style.display = 'none';
        return;
    }

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

            if (listContainer) {
                listContainer.innerHTML = '';
                list.slice(0, 3).forEach((player, i) => {
                    renderLeaderboardItem(listContainer, player, i);
                });
            }

            const myIndex = list.findIndex(p => p.name === userState.name);
            const divider = document.getElementById('leaderboard-my-divider');
            const myRowContainer = document.getElementById('leaderboard-my-row');
            
            if (myRowContainer && divider) {
                myRowContainer.innerHTML = '';
                if (myIndex >= 3) {
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
                <span class="leaderboard-name ${player.premium === 2 ? 'vip-shimmer' : ''}">${player.name}</span>
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
    { id: "frame-fire", name: "Orange Fire Frame", desc: "A spectacular blazing frame for champions.", price: 4000, type: 'frame' },
    { id: "frame-matrix", name: "Green Matrix Frame", desc: "Code rain outline for logical calculation masters.", price: 6000, type: 'frame' },
    { id: "frame-neon-yellow", name: "Glowing Neon", desc: "A vibrant yellow glowing outline.", price: 2000, type: 'frame' },
    { id: "default", name: "Standard Frame", desc: "The standard minimalistic grey outline.", price: 0, type: 'frame' }
];

const shopTitles = [
    { id: "Core Emperor", desc: "The ultimate bragging title for supreme thinkers.", price: 4800, type: 'title' },
    { id: "Mensa Member", desc: "A title fit for logical sequence masterminds.", price: 2400, type: 'title' },
    { id: "Math God", desc: "Show off your high-speed mental processing.", price: 1200, type: 'title' },
    { id: "Novice Dueler", desc: "A clean starting title for trainees.", price: 0, type: 'title' }
];

const shopBackgrounds = [
    { id: "bg-master", name: "Cosmic Particle BG", desc: "Legendary animated particles floating in deep cosmic space.", price: 8000, type: 'background' },
    { id: "bg-default", name: "Default Theme BG", desc: "The standard sleek dark-blue aesthetic.", price: 0, type: 'background' }
];

let activeShopCategory = 'frames';
let inspectItem = null;

function renderShop() {
    const gridContainer = document.getElementById('shop-items-grid');
    if (!gridContainer) return;
    gridContainer.innerHTML = '';
    
    if (activeShopCategory === 'coins') {
        gridContainer.className = 'shop-grid coins-grid';
        const packages = [
            { id: "coin-pack-1", name: "1,000 Coins", price: "2.99 €", coinsVal: 1000, desc: "Perfect starter boost.", icon: "🪙", particles: 3 },
            { id: "coin-pack-2", name: "10,000 Coins", price: "5.99 €", coinsVal: 10000, desc: "Best value pack!", icon: "💰", particles: 6 },
            { id: "coin-pack-3", name: "50,000 Coins", price: "19.99 €", coinsVal: 50000, desc: "Ultimate fortune chest.", icon: "👑🪙", particles: 9 }
        ];
        
        packages.forEach(pack => {
            const card = document.createElement('div');
            card.className = `coin-package-card ${pack.id === 'coin-pack-2' ? 'best-value' : ''}`;
            
            card.onclick = () => {
                userState.coins += pack.coinsVal;
                updateUI();
                saveState();
                alert(`Successfully purchased ${pack.name}! Credited ${pack.coinsVal.toLocaleString()} Coins to your account!`);
            };
            
            const badgeHtml = pack.id === 'coin-pack-2' ? `<span class="pack-badge">Best Value</span>` : '';
            
            let sparks = '';
            for (let i = 0; i < pack.particles; i++) {
                sparks += `<span class="coin-spark" style="animation-delay: ${i * 0.3}s; left: ${15 + Math.random() * 70}%; top: ${20 + Math.random() * 60}%;"></span>`;
            }
            
            card.innerHTML = `
                ${badgeHtml}
                <div class="coin-card-particles">${sparks}</div>
                <div class="coin-pack-icon-wrapper">
                    <span class="coin-pack-icon">${pack.icon}</span>
                </div>
                <div class="coin-card-details">
                    <div class="coin-card-name">${pack.name}</div>
                    <div class="coin-card-desc">${pack.desc}</div>
                </div>
                <span class="coin-card-price-tag">
                    Buy ${pack.price}
                </span>
            `;
            gridContainer.appendChild(card);
        });
        return;
    }
    
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
    const claimedCount = userState.streakCheckins.filter(x => x === true).length;
    streakModalCountDesc.textContent = `${userState.streak} Day Streak Active!`;
    
    const todayStr = new Date().toDateString();
    const lastClaim = localStorage.getItem(`last_streak_claim_${userState.id || 'guest'}`);
    const hasClaimedToday = (lastClaim === todayStr);
    
    const startOffset = claimedCount > 0 ? -1 : 0;
    
    for (let i = 0; i < 7; i++) {
        const slot = document.createElement('div');
        let dayClass = 'streak-day-slot';
        let iconHtml = '';
        const dayNumber = claimedCount + 1 + startOffset + i;
        
        const isLastClaimed = (claimedCount > 0 && i === 0);
        const isActiveToday = (claimedCount === 0 ? i === 0 : i === 1) && !hasClaimedToday && claimedCount < 7;
        
        if (isLastClaimed) {
            dayClass += ' claimed-yellow';
            iconHtml = `<svg class="slot-icon" style="fill:#facc15;" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
        } else if (isActiveToday) {
            dayClass += ' active-today';
            iconHtml = `<svg class="slot-icon" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
        } else {
            dayClass += ' locked';
            iconHtml = `<svg class="slot-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/></svg>`;
        }
        
        slot.className = dayClass;
        
        let labelText = '';
        if (isLastClaimed) {
            labelText = 'Claimed';
        } else if (isActiveToday) {
            labelText = 'Claim!';
        } else {
            labelText = 'Locked';
        }
        
        slot.innerHTML = `
            <span class="streak-day-label">Day ${dayNumber}</span>
            ${iconHtml}
            <span class="streak-day-val" style="font-size:10px;">${labelText}</span>
        `;
        
        if (isActiveToday) slot.addEventListener('click', claimDailyCheckIn);
        streakCalendarGrid.appendChild(slot);
    }
    
    if (claimedCount === 7) {
        streakClaimBtn.textContent = "Weekly Cycle Complete!";
        streakClaimBtn.disabled = true;
        streakClaimBtn.className = "result-btn claimed";
    } else if (hasClaimedToday) {
        streakClaimBtn.textContent = "Come Back Tomorrow!";
        streakClaimBtn.disabled = true;
        streakClaimBtn.className = "result-btn claimed";
    } else {
        streakClaimBtn.textContent = `Claim Day ${claimedCount + 1} Check-in`;
        streakClaimBtn.disabled = false;
        streakClaimBtn.className = "result-btn";
        streakClaimBtn.onclick = claimDailyCheckIn;
    }
    modalStreak.classList.add('active');
}

function claimDailyCheckIn() {
    const activeIndex = userState.streakCheckins.indexOf(false);
    if (activeIndex === -1) return;
    
    const todayStr = new Date().toDateString();
    const lastClaim = localStorage.getItem(`last_streak_claim_${userState.id || 'guest'}`);
    if (lastClaim === todayStr) {
        alert("You have already checked in today! Come back tomorrow.");
        return;
    }
    
    userState.streakCheckins[activeIndex] = true;
    userState.streak++;
    
    localStorage.setItem(`last_streak_claim_${userState.id || 'guest'}`, todayStr);
    
    const coinReward = 100;
    userState.coins += coinReward;
    
    // Grant 100 XP
    userState.xp += 100;
    if (userState.xp >= userState.xpNeeded) {
        userState.xp -= userState.xpNeeded;
        userState.level++;
        userState.xpNeeded = getXpNeeded(userState.level);
    }
    
    document.body.style.background = 'radial-gradient(circle at top, #ca8a04 0%, #060a12 100%)';
    setTimeout(() => {
        document.body.style.background = 'var(--bg-gradient)';
    }, 200);
    
    const modalStreak = document.getElementById('modal-streak');
    if (modalStreak) modalStreak.classList.remove('active');
    
    const modalRewardClaim = document.getElementById('modal-reward-claim');
    if (modalRewardClaim) modalRewardClaim.classList.add('active');
    
    if (userState.streakCheckins.every(x => x === true)) {
        userState.streakCheckins = [false, false, false, false, false, false, false];
    }
    
    updateUI();
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
    
    // HEFTIG Match found screen shake and flash effects
    const panel = document.getElementById('comp-faceoff-panel');
    const flash = document.getElementById('comp-faceoff-flash');
    if (panel) {
        panel.classList.add('shake-panel');
        setTimeout(() => panel.classList.remove('shake-panel'), 800);
    }
    if (flash) {
        flash.classList.add('faceoff-flash-active');
        setTimeout(() => flash.classList.remove('faceoff-flash-active'), 800);
    }
    
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
        oppBadge.textContent = `${oppRank.name} (${compGame.oppDetails.elo} Elo)`;
    }
    
    // Global Elo is combined and uses global doubled rank boundaries
    const myRank = getEloRank(userState.elo, true);
    const myBadge = document.getElementById('comp-faceoff-my-badge');
    if (myBadge) {
        myBadge.className = `rank-badge ${myRank.css}`;
        myBadge.textContent = `${myRank.name} (${userState.elo} Elo)`;
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
        rematchBtn.style.display = 'block';
        rematchBtn.onclick = () => {
            const modalResult = document.getElementById('modal-result');
            if (modalResult) modalResult.classList.remove('active');
            
            const currentMode = compGame.mode || 'math';
            startRankedMatchmaking(currentMode);
        };
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

function renderProfileCosmetics() {
    const titleSelect = document.getElementById('profile-equipped-title-select');
    const frameSelect = document.getElementById('profile-equipped-frame-select');
    const bgSelect = document.getElementById('profile-equipped-bg-select');
    if (!titleSelect || !frameSelect || !bgSelect) return;

    titleSelect.innerHTML = '';
    frameSelect.innerHTML = '';
    bgSelect.innerHTML = '';

    const allFrames = [
        { id: "default", name: "Standard Frame" },
        { id: "frame-fire", name: "Orange Fire Frame" },
        { id: "frame-matrix", name: "Green Matrix Frame" },
        { id: "frame-neon-yellow", name: "Glowing Neon Frame" },
        { id: "frame-cosmic", name: "Cosmic Glow Frame" }
    ];

    const allTitles = [
        { id: "Novice Dueler", name: "Novice Dueler" },
        { id: "Elite Duelist", name: "Elite Duelist" },
        { id: "Cosmic King", name: "Cosmic King" },
        { id: "Core Emperor", name: "Core Emperor" },
        { id: "Mensa Member", name: "Mensa Member" },
        { id: "Math God", name: "Math God" }
    ];

    const allBackgrounds = [
        { id: "bg-default", name: "Default Theme BG" },
        { id: "bg-master", name: "Cosmic Particle BG" }
    ];

    allFrames.forEach(f => {
        const isPremiumCosmic = (f.id === 'frame-cosmic' && userState.premium === 2);
        if (userState.inventory.includes(f.id) || isPremiumCosmic || f.id === 'default') {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.name;
            opt.selected = (userState.equippedFrame === f.id);
            frameSelect.appendChild(opt);
        }
    });

    allTitles.forEach(t => {
        const isPremiumLite = (t.id === 'Elite Duelist' && userState.premium >= 1);
        const isPremiumCosmic = (t.id === 'Cosmic King' && userState.premium === 2);
        if (userState.inventory.includes(t.id) || isPremiumLite || isPremiumCosmic || t.id === 'Novice Dueler') {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            opt.selected = (userState.equippedTitle === t.id);
            titleSelect.appendChild(opt);
        }
    });

    allBackgrounds.forEach(b => {
        const isPremiumCosmic = (b.id === 'bg-master' && userState.premium === 2);
        if (userState.inventory.includes(b.id) || isPremiumCosmic || b.id === 'bg-default') {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            opt.selected = (userState.equippedBackground === b.id);
            bgSelect.appendChild(opt);
        }
    });
}

function setupCosmeticsListeners() {
    const titleSelect = document.getElementById('profile-equipped-title-select');
    const frameSelect = document.getElementById('profile-equipped-frame-select');
    const bgSelect = document.getElementById('profile-equipped-bg-select');
    
    if (titleSelect) {
        titleSelect.onchange = (e) => {
            userState.equippedTitle = e.target.value;
            updateUI();
            saveState();
        };
    }
    if (frameSelect) {
        frameSelect.onchange = (e) => {
            userState.equippedFrame = e.target.value;
            updateUI();
            saveState();
        };
    }
    if (bgSelect) {
        bgSelect.onchange = (e) => {
            userState.equippedBackground = e.target.value;
            updateUI();
            saveState();
        };
    }
}

function showProfileModal() {
    updateUI();
    renderProfileCosmetics();
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
    return; // Combo badges disabled during duels
    
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
    setupCosmeticsListeners();
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
    
    // Purchase premium simulated buttons
    const buyPremiumLiteBtn = document.getElementById('buy-premium-lite-btn');
    if (buyPremiumLiteBtn) {
        buyPremiumLiteBtn.onclick = () => {
            userState.premium = 1;
            if (!userState.inventory.includes('Elite Duelist')) {
                userState.inventory.push('Elite Duelist');
            }
            userState.equippedTitle = 'Elite Duelist';
            updateUI();
            renderPass();
            saveState();
            alert("Gold Pass Activated! Enjoy +100 daily coins, +100 daily XP, and the 'Elite Duelist' title!");
        };
    }

    const buyPremiumCosmicBtn = document.getElementById('buy-premium-cosmic-btn');
    if (buyPremiumCosmicBtn) {
        buyPremiumCosmicBtn.onclick = () => {
            // Upgrade to Premium 2 (Ultimate Cosmic Deal)
            userState.premium = 2;
            
            // Add +2,000 Coins instantly
            userState.coins += 2000;
            
            // Give Master Background
            if (!userState.inventory.includes('bg-master')) {
                userState.inventory.push('bg-master');
            }
            userState.equippedBackground = 'bg-master';
            
            // Give Cosmic King Title
            if (!userState.inventory.includes('Cosmic King')) {
                userState.inventory.push('Cosmic King');
            }
            userState.equippedTitle = 'Cosmic King';
            
            // Give Cosmic Glow Frame
            if (!userState.inventory.includes('frame-cosmic')) {
                userState.inventory.push('frame-cosmic');
            }
            userState.equippedFrame = 'frame-cosmic';
            
            updateUI();
            renderPass();
            saveState();
            alert("ULTIMATE COSMIC DEAL UNLOCKED! 🌌 Enjoy permanent Ad-free, instant 2,000 coins, the Master Background, 'Cosmic King' title, and the spinning 'Cosmic Glow' avatar frame!");
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
    
    // Close reward claim modal
    const rewardClaimCloseBtn = document.getElementById('reward-claim-close-btn');
    if (rewardClaimCloseBtn) {
        rewardClaimCloseBtn.onclick = () => {
            const m = document.getElementById('modal-reward-claim');
            if (m) m.classList.remove('active');
        };
    }

    // Open friends modal
    const friendsHeaderTrigger = document.getElementById('friends-header-trigger');
    const modalFriends = document.getElementById('modal-friends');
    if (friendsHeaderTrigger && modalFriends) {
        friendsHeaderTrigger.onclick = () => {
            modalFriends.classList.add('active');
            renderFriendsList();
        };
    }

    const friendsCloseBtn = document.getElementById('friends-close-btn');
    if (friendsCloseBtn && modalFriends) {
        friendsCloseBtn.onclick = () => {
            modalFriends.classList.remove('active');
        };
    }

    // Add friend input action
    const friendsAddActionBtn = document.getElementById('friends-add-action-btn');
    const friendsUsernameInput = document.getElementById('friends-username-input');
    if (friendsAddActionBtn && friendsUsernameInput) {
        friendsAddActionBtn.onclick = () => {
            addFriend(friendsUsernameInput.value);
            friendsUsernameInput.value = '';
        };
    }

    // Invite sharing actions
    const shareWhatsappBtn = document.getElementById('share-whatsapp-btn');
    if (shareWhatsappBtn) {
        shareWhatsappBtn.onclick = () => {
            window.open(`https://api.whatsapp.com/send?text=Duel%20me%20on%20CoreDuel!%20http://localhost:8000`, '_blank');
        };
    }

    const shareCopyBtn = document.getElementById('share-copy-btn');
    if (shareCopyBtn) {
        shareCopyBtn.onclick = () => {
            navigator.clipboard.writeText("http://localhost:8000").then(() => {
                alert("Invite link copied to clipboard!");
            });
        };
    }

    // Avatar presets modal picker triggers
    const profileEditAvatarTrigger = document.getElementById('profile-edit-avatar-trigger');
    const modalAvatarPicker = document.getElementById('modal-avatar-picker');
    if (profileEditAvatarTrigger && modalAvatarPicker) {
        profileEditAvatarTrigger.onclick = () => {
            selectedPickerSeed = userState.avatarSeed;
            modalAvatarPicker.classList.add('active');
            renderAvatarPicker();
        };
    }

    const avatarPickerCloseBtn = document.getElementById('avatar-picker-close-btn');
    if (avatarPickerCloseBtn && modalAvatarPicker) {
        avatarPickerCloseBtn.onclick = () => {
            modalAvatarPicker.classList.remove('active');
        };
    }

    const avatarPickerConfirmBtn = document.getElementById('avatar-picker-confirm-btn');
    if (avatarPickerConfirmBtn && modalAvatarPicker) {
        avatarPickerConfirmBtn.onclick = () => {
            if (selectedPickerSeed) {
                userState.avatarSeed = selectedPickerSeed;
                updateUI();
                saveState();
            }
            modalAvatarPicker.classList.remove('active');
        };
    }

    // Leaderboard sub-tabs click handlers
    const leaderboardSubtabs = document.getElementById('leaderboard-subtabs');
    if (leaderboardSubtabs) {
        leaderboardSubtabs.querySelectorAll('.lb-subtab').forEach(btn => {
            btn.onclick = () => {
                activeLbSubcategory = btn.getAttribute('data-lb-sub');
                renderLeaderboard();
            };
        });
    }

    window.onclick = (e) => {
        const modalStreak = document.getElementById('modal-streak');
        const modalTournament = document.getElementById('modal-tournament');
        const modalInspect = document.getElementById('modal-shop-inspect');
        const modalResult = document.getElementById('modal-result');
        const modalFriends = document.getElementById('modal-friends');
        const modalAvatarPicker = document.getElementById('modal-avatar-picker');
        const modalRewardClaim = document.getElementById('modal-reward-claim');
        if (e.target === modalProfile) modalProfile.classList.remove('active');
        if (e.target === modalStreak) modalStreak.classList.remove('active');
        if (e.target === modalTournament) modalTournament.classList.remove('active');
        if (e.target === modalResult) modalResult.classList.remove('active');
        if (e.target === modalSettings) modalSettings.classList.remove('active');
        if (e.target === modalInspect) closeShopInspect();
        if (e.target === modalFriends) modalFriends.classList.remove('active');
        if (e.target === modalAvatarPicker) modalAvatarPicker.classList.remove('active');
        if (e.target === modalRewardClaim) modalRewardClaim.classList.remove('active');
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
// ==================== FRIENDS & AVATAR PICKER SYSTEM HELPERS ====================
let selectedPickerSeed = null;

function addFriend(friendName) {
    if (!friendName) return;
    friendName = friendName.trim();
    if (friendName === userState.name) {
        alert("You cannot add yourself as a friend!");
        return;
    }
    
    userState.friends = userState.friends || [];
    
    // Check if already added
    if (userState.friends.some(f => f.name.toLowerCase() === friendName.toLowerCase())) {
        alert("This player is already in your friend list!");
        return;
    }
    
    const elo = Math.floor(Math.random() * 800) + 100;
    const newFriend = {
        name: friendName,
        elo: elo,
        streak: Math.floor(Math.random() * 5),
        title: elo > 600 ? 'Math Master' : 'Dueling Novice',
        frame: elo > 800 ? 'frame-neon-yellow' : 'default',
        background: elo > 1000 ? 'bg-master' : 'bg-default',
        avatarSeed: friendName,
        premium: elo > 900 ? 2 : 0
    };
    
    userState.friends.push(newFriend);
    saveState();
    updateUI();
    renderLeaderboard();
    renderFriendsList();
    alert(`Successfully added ${friendName} as a friend!`);
}

function renderFriendsList() {
    const container = document.getElementById('friends-list-container');
    if (!container) return;
    container.innerHTML = '';
    
    userState.friends = userState.friends || [];
    if (userState.friends.length === 0) {
        container.innerHTML = `<span style="font-size:11px; color:var(--color-text-muted); font-style:italic;">No friends added yet.</span>`;
        return;
    }
    
    userState.friends.forEach(f => {
        const item = document.createElement('div');
        item.className = 'friend-item-row';
        
        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <img src="https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${f.avatarSeed}" style="width:24px; height:24px; border-radius:50%;" alt="Avatar">
                <span style="font-size:12px; font-weight:800; color:#fff;">${f.name}</span>
            </div>
            <span style="font-size:11px; color:var(--color-accent); font-weight:800;">${f.elo} Elo</span>
        `;
        container.appendChild(item);
    });
}

function renderAvatarPicker() {
    const grid = document.getElementById('avatar-presets-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const presets = ["Nova", "Aura", "Quantum", "Volt", "Zen", "Atlas", "Pixel", "Cosmo", "Echo", "Titan", "Cyber", "Aero"];
    presets.forEach(seed => {
        const opt = document.createElement('div');
        opt.style.borderRadius = '50%';
        opt.style.padding = '3px';
        opt.style.border = seed === selectedPickerSeed ? '2px solid var(--color-accent)' : '2px solid transparent';
        opt.style.cursor = 'pointer';
        opt.style.display = 'flex';
        opt.style.alignItems = 'center';
        opt.style.justifyContent = 'center';
        
        opt.onclick = () => {
            selectedPickerSeed = seed;
            renderAvatarPicker();
        };
        
        opt.innerHTML = `<img src="https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${seed}" style="width:100%; height:100%; border-radius:50%;" alt="Preset">`;
        grid.appendChild(opt);
    });
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
