import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Home page route handler
 * This is the new landing page for the launchpad
 */
export function renderHomePage() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }
    
    // Load home page specific stylesheet
    stylesheetLoader.load('src/routes/home.css', 'home-styles');
    
    // Unload CULT EXEC styles if they were loaded
    stylesheetLoader.unload('cultexecs-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';
    
    // Create home page content
    appContainer.innerHTML = `
        <div class="home-page">
            <div class="home-hero">
                <h1 class="home-title">MS2.FUN LAUNCHPAD</h1>
                <p class="home-subtitle">Discover and interact with Web3 projects</p>
            </div>
            
            <div class="home-content">
                <div class="home-section">
                    <h2>Featured Projects</h2>
                    <div class="project-grid">
                        <div class="project-card">
                            <h3>CULT EXEC</h3>
                            <p>ERC404 Bonding Curve Project</p>
                            <a href="/cultexecs" class="project-link">View Project →</a>
                        </div>
                        <!-- More project cards will be added here -->
                    </div>
                </div>
                
                <div class="home-section">
                    <h2>About</h2>
                    <p>Welcome to the MS2.FUN launchpad. Browse projects, interact with contracts, and discover the future of Web3.</p>
                </div>
            </div>
        </div>
    `;
    
    // Add click handlers for navigation
    const projectLinks = appContainer.querySelectorAll('.project-link');
    projectLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const href = link.getAttribute('href');
            if (window.router) {
                window.router.navigate(href);
            } else {
                window.location.href = href;
            }
        });
    });
    
    // Return cleanup function
    return {
        cleanup: () => {
            // Unload stylesheet (optional - you may want to keep it loaded)
            // stylesheetLoader.unload('home-styles');
        }
    };
}

