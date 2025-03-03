require('dotenv').config();
const express = require('express');
const playwright = require('playwright');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 5010;

app.use(cors());
app.use(express.json());

// In-memory storage for scraped jobs
let scrapedJobs = [];

// Modify your scrapeJobs function to handle both URLs and keywords
async function scrapeJobs(urlOrKeyword) {
    let url = urlOrKeyword;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://www.indeed.com/jobs?q=${encodeURIComponent(urlOrKeyword)}&l=`;
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36', // Standard Chrome User-Agent
    });
    const page = await context.newPage();

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

        // 1. Wait for the main container to be present (not necessarily visible children).
        await page.waitForSelector('#mosaic-provider-jobcards', { timeout: 20000 });

        // 2. Wait for the <ul> to be present *inside* the container.
        await page.waitForSelector('#mosaic-provider-jobcards ul', { timeout: 20000 });

        // 3.  NOW we can select the job cards.
        const jobCards = await page.$$('#mosaic-provider-jobcards ul li.css-1ac2h1w');
        console.log(`Found ${jobCards.length} job cards`);

        for (const card of jobCards) {
            try {
                const jobBeacon = await card.$('.job_seen_beacon');
                if (!jobBeacon) {
                    console.log("Skipping card - no job_seen_beacon found");
                    continue;
                }

                let title = await jobBeacon.$eval('a', el => el.textContent).catch(() => 'N/A');
                let company = await jobBeacon.$eval('span[data-testid="company-name"]', el => el.textContent).catch(() => 'N/A'); // Use data-testid
                let location = await jobBeacon.$eval('div[data-testid="text-location"]', el => el.textContent).catch(() => 'N/A'); // Use data-testid

                const linkElement = await jobBeacon.$('a');
                const relativeLink = linkElement ? await linkElement.getAttribute('href') : null;
                const link = relativeLink ? new URL(relativeLink, url).href : null;

                jobs.push({
                    title: title.trim(),
                    company: company.trim(),
                    location: location.trim(),
                    link: link
                });
            } catch (innerError) {
                console.error('Error processing a job listing:', innerError);
            }
        }

        if (jobs.length === 0) {
            await page.screenshot({ path: 'debug-screenshot.png' });
        }

        return jobs;
    } catch (error) {
        console.error('Error during page navigation or scraping:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// Modify your /api/scrape endpoint to handle both URLs and keywords
app.get('/api/scrape', async (req, res) => {
    try {
        const urlOrKeyword = req.query.url || req.query.keywords;
        if (!urlOrKeyword) {
            return res.status(400).json({ error: 'URL or keywords are required' });
        }

        console.log(`Starting scrape for: ${urlOrKeyword}`);
        const newJobs = await scrapeJobs(urlOrKeyword);
        console.log(`Scraping complete. Found ${newJobs.length} jobs.`);
        
        // Add new jobs to in-memory storage, avoiding duplicates
        newJobs.forEach(newJob => {
            if (!scrapedJobs.some(existingJob => existingJob.link === newJob.link)) {
                scrapedJobs.push(newJob);
            }
        });

        // Send a clear response to frontend
        res.json({
            success: true,
            count: newJobs.length,
            jobs: newJobs
        });
    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ 
            error: 'Failed to scrape jobs: ' + error.message,
            success: false
        });
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});