const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scrollContainer = document.getElementById('wiki-container');
const targetSelect = document.getElementById('target-select');

let width = canvas.width = window.innerWidth;
let height = canvas.height = window.innerHeight;
const mouse = { x: width / 2, y: height / 2 };
let textNodes = [];
let activeSemanticTag = null;

let lastInteractionTime = performance.now();
let isAutonomous = false;
let currentWanderNodeIndex = 0;

let ripples = [];

function registerInteraction() {
    lastInteractionTime = performance.now();
    if (isAutonomous) isAutonomous = false;
}

if (targetSelect) {
    targetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        activeSemanticTag = val === 'all' ? null : val;
        isAutonomous = false;
        registerInteraction();
        spider.legs.forEach(leg => leg.stepProgress = 1);
    });
}

// ---------------------------------------------------------
// MOBILE PERFORMANCE FIX 1: Debounced Resizing
// Prevents the engine from crashing when the mobile URL bar hides/shows
// ---------------------------------------------------------
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        cacheSemanticWords(); 
    }, 150);
});

function cacheSemanticWords() {
    textNodes = [];
    const elements = document.querySelectorAll('.keyword');
    elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        textNodes.push({
            element: el,
            tag: el.getAttribute('data-tag'),
            left: rect.left,
            top: rect.top + scrollContainer.scrollTop,
            right: rect.right,
            bottom: rect.bottom + scrollContainer.scrollTop,
            width: rect.width,
            height: rect.height,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2 + scrollContainer.scrollTop
        });
    });
}

// ---------------------------------------------------------
// MOBILE CONTROL FIX 2: Universal Input Tracking
// Maps both mouse clicks and finger touches to the spider's brain
// ---------------------------------------------------------
function updateTargetPosition(clientX, clientY) {
    mouse.x = clientX;
    mouse.y = clientY;
    registerInteraction();
}

// Desktop Mouse
scrollContainer.addEventListener('mousemove', (e) => {
    updateTargetPosition(e.clientX, e.clientY);
});

// Mobile Touch
scrollContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) updateTargetPosition(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

scrollContainer.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) updateTargetPosition(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

// ---------------------------------------------------------
// MOBILE PERFORMANCE FIX 3: Debounced Scrolling
// Stops the CPU from burning out during smooth touch-scrolling
// ---------------------------------------------------------
let scrollTimeout;
scrollContainer.addEventListener('scroll', () => { 
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        cacheSemanticWords(); 
    }, 100);
});

window.addEventListener('wheel', registerInteraction, { passive: true });

function spawnWaterRipple(x, y, colorHex) {
    const ripple = document.createElement('div');
    ripple.className = 'water-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.style.setProperty('--ripple-color', colorHex);
    
    scrollContainer.appendChild(ripple);
    
    setTimeout(() => {
        if (ripple.parentElement) ripple.remove();
    }, 1000);
}

const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const angleBetween = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
const lerp = (a, b, n) => (1 - n) * a + n * b;

function solveIK(rootX, rootY, targetX, targetY, len1, len2, flip = 1) {
    const d = dist(rootX, rootY, targetX, targetY);
    let tX = targetX, tY = targetY;
    if (d > len1 + len2) {
        const angle = angleBetween(rootX, rootY, targetX, targetY);
        tX = rootX + Math.cos(angle) * (len1 + len2 - 0.1);
        tY = rootY + Math.sin(angle) * (len1 + len2 - 0.1);
    }
    const baseAngle = angleBetween(rootX, rootY, tX, tY);
    const currentDist = dist(rootX, rootY, tX, tY);
    const cosAngle1 = (len1 * len1 + currentDist * currentDist - len2 * len2) / (2 * len1 * currentDist);
    const angle1 = Math.acos(Math.max(-1, Math.min(1, cosAngle1)));
    const joint1X = rootX + Math.cos(baseAngle + angle1 * flip) * len1;
    const joint1Y = rootY + Math.sin(baseAngle + angle1 * flip) * len1;
    return { jointX: joint1X, jointY: joint1Y, effectorX: tX, effectorY: tY };
}

class SemanticLeg {
    constructor(parent, angleOffset, side, index) {
        this.parent = parent;
        this.angleOffset = angleOffset;
        this.side = side;
        this.index = index;
        this.len1 = 50; this.len2 = 70;
        this.shoulderX = 0; this.shoulderY = 0;
        this.footX = 0; this.footY = 0;
        this.targetFootX = 0; this.targetFootY = 0;
        this.startX = 0; this.startY = 0;
        this.stepProgress = 1; this.stepSpeed = 0.18;
        this.stepRadius = 60; this.reachExt = 95;
        this.currentLift = 0;
        this.isSnapped = false; this.snappedWord = null;
        
        this.tagColors = {
            'myth': '#506eff',
            'history': '#ff33b8',
            'media': '#b833ff',
            'bio': '#00ffaa'
        };
    }
    updateShoulder() {
        const rx = Math.cos(this.parent.angle);
        const ry = Math.sin(this.parent.angle);
        const localOffsetX = Math.cos(this.angleOffset) * 22;
        const localOffsetY = Math.sin(this.angleOffset) * 16;
        this.shoulderX = this.parent.x + (localOffsetX * rx - localOffsetY * ry);
        this.shoulderY = this.parent.y + (localOffsetX * ry + localOffsetY * rx);
    }
    findSemanticAnchor(idealX, idealY) {
        let bestTarget = null; let minScore = Infinity;
        textNodes.forEach(node => {
            const clampedX = Math.max(node.left, Math.min(idealX, node.right));
            const clampedY = Math.max(node.top, Math.min(idealY, node.bottom));
            const d = dist(idealX, idealY, clampedX, clampedY);
            let score = d;
            if (activeSemanticTag && node.tag === activeSemanticTag) score -= 40;
            
            if (score < minScore && d < 100) {
                minScore = score;
                bestTarget = { x: clampedX, y: clampedY, node: node };
            }
        });
        if (bestTarget) return { x: bestTarget.x, y: bestTarget.y, snapped: true, node: bestTarget.node };
        return { x: idealX, y: idealY, snapped: false, node: null };
    }
    update(canStep) {
        this.updateShoulder();
        const idealAngle = this.parent.angle + this.angleOffset;
        const idealX = this.shoulderX + Math.cos(idealAngle) * this.reachExt;
        const idealY = this.shoulderY + Math.sin(idealAngle) * this.reachExt;
        
        const breakRadius = this.isSnapped ? 115 : this.stepRadius;
        
        if (dist(this.targetFootX, this.targetFootY, idealX, idealY) > breakRadius && this.stepProgress >= 1 && canStep) {
            this.startX = this.footX; 
            this.startY = this.footY;
            const anchor = this.findSemanticAnchor(idealX, idealY);
            
            if (dist(this.startX, this.startY, anchor.x, anchor.y) > 2) {
                this.targetFootX = anchor.x; 
                this.targetFootY = anchor.y;
                this.isSnapped = anchor.snapped; 
                this.snappedWord = anchor.node;
                
                if (this.isSnapped && this.snappedWord) {
                    const colorHex = this.tagColors[this.snappedWord.tag] || '#00b3ff';
                    spawnWaterRipple(this.targetFootX, this.targetFootY, colorHex);
                }
                this.stepProgress = 0;
            }
        }
        
        if (this.stepProgress < 1) {
            this.stepProgress += this.stepSpeed;
            this.footX = lerp(this.startX, this.targetFootX, this.stepProgress);
            this.footY = lerp(this.startY, this.targetFootY, this.stepProgress);
            this.currentLift = Math.sin(this.stepProgress * Math.PI) * 25;
        } else {
            this.stepProgress = 1; 
            this.footX = this.targetFootX; 
            this.footY = this.targetFootY; 
            this.currentLift = 0;
        }
    }
    
    drawHighlight() {
        if (!this.isSnapped || !this.snappedWord) return;
        const cColor = this.tagColors[this.snappedWord.tag] || '#00b3ff';
        
        ctx.strokeStyle = cColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(this.snappedWord.left - 2, this.snappedWord.top - 2, this.snappedWord.width + 4, this.snappedWord.height + 4);
        
        ctx.beginPath();
        ctx.moveTo(this.footX - 4, this.footY); ctx.lineTo(this.footX + 4, this.footY);
        ctx.moveTo(this.footX, this.footY - 4); ctx.lineTo(this.footX, this.footY + 4);
        ctx.stroke();
    }

    draw() {
        const solved = solveIK(this.shoulderX, this.shoulderY, this.footX, this.footY - this.currentLift, this.len1, this.len2, this.side);
        
        let upperLegColor = "#5e6a7d";
        let lowerLegColor = "#3b4a5e";
        let footColor = "#64748b";
        
        if (this.isSnapped && this.snappedWord) {
            const activeHex = this.tagColors[this.snappedWord.tag] || "#00b3ff";
            upperLegColor = activeHex;
            lowerLegColor = activeHex;
            footColor = activeHex;
        }
        
        ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
        
        ctx.strokeStyle = upperLegColor;
        ctx.beginPath(); ctx.moveTo(this.shoulderX, this.shoulderY); ctx.lineTo(solved.jointX, solved.jointY); ctx.stroke();
        
        ctx.strokeStyle = lowerLegColor;
        ctx.beginPath(); ctx.moveTo(solved.jointX, solved.jointY); ctx.lineTo(solved.effectorX, solved.effectorY); ctx.stroke();
        
        ctx.fillStyle = footColor;
        ctx.beginPath(); ctx.arc(solved.effectorX, solved.effectorY - this.currentLift, 3.5, 0, Math.PI * 2); ctx.fill();
        
        this.drawHighlight();
    }
}

class DOMSpider {
    constructor(x, y) {
        this.x = x; this.y = y; this.angle = 0; this.speed = 0;
        this.legs = [];
        for (let i = 0; i < 8; i++) {
            const side = i < 4 ? -1 : 1;
            const baseAngle = side === -1 ? -Math.PI : 0;
            const offset = baseAngle + (i % 4 - 1.5) * (Math.PI / 5);
            this.legs.push(new SemanticLeg(this, offset, side, i));
        }
        this.activeGroup = true;
    }
    getAutonomousTarget() {
        if (!textNodes.length) return { x: width / 2, y: this.y + 100 };
        const sortedNodes = [...textNodes].sort((a, b) => a.top - b.top);
        let validNodes = activeSemanticTag ? sortedNodes.filter(n => n.tag === activeSemanticTag) : sortedNodes;
        if (validNodes.length === 0) validNodes = sortedNodes;
        
        const targetNode = validNodes[currentWanderNodeIndex % validNodes.length];
        const distanceToTarget = dist(this.x, this.y, targetNode.centerX, targetNode.centerY);
        
        if (distanceToTarget < 110) {
            currentWanderNodeIndex = (currentWanderNodeIndex + 1) % validNodes.length;
        }
        return { x: targetNode.centerX, y: targetNode.centerY, node: targetNode };
    }
    update() {
        const scrollY = scrollContainer.scrollTop;
        const now = performance.now();
        
        if (now - lastInteractionTime > 3000) {
            if (!isAutonomous) {
                isAutonomous = true;
                if (textNodes.length > 0) {
                    const sortedNodes = [...textNodes].sort((a, b) => a.top - b.top);
                    let validNodes = activeSemanticTag ? sortedNodes.filter(n => n.tag === activeSemanticTag) : sortedNodes;
                    if (validNodes.length === 0) validNodes = sortedNodes;
                    
                    let closestIdx = 0, minDist = Infinity;
                    for (let i = 0; i < validNodes.length; i++) {
                        const d = dist(this.x, this.y, validNodes[i].centerX, validNodes[i].centerY);
                        if (d < minDist) { minDist = d; closestIdx = i; }
                    }
                    currentWanderNodeIndex = closestIdx;
                }
            }
        }

        let targetX, targetY;
        if (isAutonomous) {
            const wander = this.getAutonomousTarget();
            targetX = wander.x;
            targetY = wander.y;
        } else {
            targetX = mouse.x;
            targetY = mouse.y + scrollY;
        }

        const targetDist = dist(this.x, this.y, targetX, targetY);
        const viewY = this.y - scrollY;
        const scrollThreshold = 140; const maxScrollVelocity = 7;
        
        if (viewY < scrollThreshold && scrollContainer.scrollTop > 0) {
            scrollContainer.scrollTop -= ((scrollThreshold - viewY) / scrollThreshold) * maxScrollVelocity;
        } else if (height - viewY < scrollThreshold) {
            scrollContainer.scrollTop += ((scrollThreshold - (height - viewY)) / scrollThreshold) * maxScrollVelocity;
        }

        if (targetDist > 14) {
            const targetAngle = angleBetween(this.x, this.y, targetX, targetY);
            let diff = targetAngle - this.angle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            
            this.angle += diff * 0.12; 
            this.speed = Math.min(targetDist * 0.05, isAutonomous ? 3.5 : 5);
            this.x += Math.cos(this.angle) * this.speed;
            this.y += Math.sin(this.angle) * this.speed;
        } else { 
            this.speed = 0; 
            this.x = Math.round(this.x);
            this.y = Math.round(this.y);
        }

        let groupAReady = true; let groupBReady = true;
        this.legs.forEach(leg => {
            if (leg.index % 2 === 0) { if (leg.stepProgress < 1) groupAReady = false; }
            else { if (leg.stepProgress < 1) groupBReady = false; }
        });
        if (this.activeGroup && !groupAReady) this.activeGroup = false;
        else if (!this.activeGroup && !groupBReady) this.activeGroup = true;
        this.legs.forEach(leg => {
            const isEven = (leg.index % 2 === 0);
            leg.update(this.activeGroup ? isEven : !isEven);
        });
    }

    draw() {
        const scrollY = scrollContainer.scrollTop;
        ctx.save(); ctx.translate(0, -scrollY);
        
        this.legs.forEach(leg => {
            if (leg.isSnapped && leg.snappedWord && leg.snappedWord.tag === activeSemanticTag) {
                textNodes.forEach(node => {
                    if (node.tag === activeSemanticTag && node !== leg.snappedWord) {
                        ctx.strokeStyle = "rgba(0, 255, 170, 0.08)"; ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(leg.footX, leg.footY); ctx.lineTo(node.centerX, node.centerY); ctx.stroke();
                    }
                });
            }
        });

        this.legs.forEach(leg => leg.draw());
        
        ctx.save();
        ctx.translate(this.x, this.y); ctx.rotate(this.angle);
        ctx.fillStyle = "#0c0f17"; ctx.strokeStyle = activeSemanticTag ? "#00ffaa" : "#4a5568"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(0, 0, 16, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(12, -4, 2, 0, Math.PI * 2); ctx.arc(12, 4, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#00ffaa"; ctx.beginPath(); ctx.arc(9, -7, 1.5, 0, Math.PI * 2); ctx.arc(9, 7, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        ctx.restore();
    }
}

const spider = new DOMSpider(width / 2, height / 3);
setTimeout(() => { cacheSemanticWords(); }, 600);

function animate() {
    ctx.clearRect(0, 0, width, height);
    spider.update(); spider.draw();
    requestAnimationFrame(animate);
}
animate();
