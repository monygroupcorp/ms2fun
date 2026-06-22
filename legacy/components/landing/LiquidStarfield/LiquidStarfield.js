import { Component } from '../../../core/Component.js';

export class LiquidStarfield extends Component {
    static styles = `
        .liquid-starfield {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
        }
    `;

    constructor(rootElement) {
        super(rootElement);
        this.state = {
            particles: [],
            mouse: { x: 0, y: 0 },
            lastMouse: { x: 0, y: 0 }
        };
        
        this.config = {
            particleCount: 50,
            baseRadius: 2,
            rangeRadius: 4,
            baseSpeed: 0.1,
            rangeSpeed: 0.5,
            interactionRadius: 100,
            baseHue: 320, // Pink base
            rangeHue: 40,  // Hue variation
        };
    }

    template() {
        return `
            <canvas class="liquid-starfield"></canvas>
        `;
    }

    events() {
        return {
            'mousemove': this.handleMouseMove.bind(this),
            'touchmove': this.handleTouchMove.bind(this)
        };
    }

    handleMouseMove(e) {
        this.state.mouse = {
            x: e.clientX,
            y: e.clientY
        };
    }

    handleTouchMove(e) {
        e.preventDefault();
        this.state.mouse = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
        };
    }

    onMount() {
        this.canvas = this.element.querySelector('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.initParticles();
        this.animate();

        window.addEventListener('resize', this.resizeCanvas.bind(this));
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    initParticles() {
        this.state.particles = [];
        for (let i = 0; i < this.config.particleCount; i++) {
            this.state.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                radius: this.config.baseRadius + Math.random() * this.config.rangeRadius,
                speedX: (Math.random() - 0.5) * this.config.rangeSpeed,
                speedY: (Math.random() - 0.5) * this.config.rangeSpeed,
                hue: this.config.baseHue + Math.random() * this.config.rangeHue
            });
        }
    }

    animate() {
        this.ctx.fillStyle = 'rgba(26, 26, 26, 0.1)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.state.particles.forEach(particle => {
            // Update position
            particle.x += particle.speedX;
            particle.y += particle.speedY;

            // Mouse interaction
            const dx = this.state.mouse.x - particle.x;
            const dy = this.state.mouse.y - particle.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < this.config.interactionRadius) {
                const force = (this.config.interactionRadius - distance) / this.config.interactionRadius;
                particle.speedX -= dx * force * 0.02;
                particle.speedY -= dy * force * 0.02;
            }

            // Boundaries
            if (particle.x < 0 || particle.x > this.canvas.width) particle.speedX *= -1;
            if (particle.y < 0 || particle.y > this.canvas.height) particle.speedY *= -1;

            // Draw particle
            this.ctx.beginPath();
            const gradient = this.ctx.createRadialGradient(
                particle.x, particle.y, 0,
                particle.x, particle.y, particle.radius
            );
            gradient.addColorStop(0, `hsla(${particle.hue}, 100%, 70%, 0.8)`);
            gradient.addColorStop(1, `hsla(${particle.hue}, 100%, 70%, 0)`);
            this.ctx.fillStyle = gradient;
            this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            this.ctx.fill();
        });

        requestAnimationFrame(this.animate.bind(this));
    }

    onUnmount() {
        window.removeEventListener('resize', this.resizeCanvas.bind(this));
    }
}