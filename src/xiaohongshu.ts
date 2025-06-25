import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

// RedNote interface to support new fields
export interface RedBookNote {
  title: string;
  content: string;
  author: string;
  authorDesc?: string;
  link: string;
  likes?: number;
  collects?: number;
  comments?: number;
  tags?: string[];
  images?: string[];
}

// Cookies file path
const COOKIES_PATH = path.join(process.cwd(), 'cookies', 'xiaohongshu-cookies.json');

// Check if cookies exist
async function cookiesExist(): Promise<boolean> {
  try {
    await fs.access(COOKIES_PATH);
    return true;
  } catch {
    return false;
  }
}

// Save cookies
async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    const cookiesDir = path.join(process.cwd(), 'cookies');
    
    await fs.mkdir(cookiesDir, { recursive: true });
    await fs.writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.error('Successfully saved cookies for next use');
  } catch (error) {
    console.error('Failed to save cookies:', error);
  }
}

// Load cookies
async function loadCookies(context: BrowserContext): Promise<boolean> {
  try {
    const cookiesJson = await fs.readFile(COOKIES_PATH, 'utf-8');
    const cookies = JSON.parse(cookiesJson);
    await context.addCookies(cookies);
    console.error('Successfully loaded cookies');
    return true;
  } catch (error) {
    console.error('Failed to load cookies:', error);
    return false;
  }
}

// Check login status
async function checkLoginStatus(page: Page): Promise<boolean> {
  const loginButtonSelector = '.login-container';
  
  try {
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('sign')) {
      return false;
    }
    
    const loginButton = await page.$(loginButtonSelector);
    return !loginButton;
  } catch (error) {
    console.error('Error checking login status:', error);
    return false;
  }
}

// Auto-scroll page to load more content
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const maxScrolls = 10; // Limit maximum scroll count
      let scrollCount = 0;
      
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrollCount++;
        
        if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
          clearInterval(timer);
          resolve();
        }
      }, 200); // More reasonable scroll interval
    });
  });
  
  // Wait for content to load
  await page.waitForTimeout(2000);
}

// Get detailed content from note detail page
async function getNoteDetailData(page: Page): Promise<{
  title: string;
  content: string;
  author: string;
  authorDesc?: string;
  images: string[];
  likes: number;
  collects: number;
  comments: number;
  tags: string[];
}> {
  try {
    // Wait for core page elements to load
    await page.waitForSelector('#detail-title', { timeout: 3000 })
      .catch(() => console.error('Title element not found, page structure may have changed'));
    
    // Extract detailed note data
    return await page.evaluate(() => {
      // Get title
      const titleElement = document.querySelector('#detail-title');
      const title = titleElement ? titleElement.textContent?.trim() || '' : '';
      
      // Get content text
      const contentElement = document.querySelector('#detail-desc .note-text');
      let content = '';
      if (contentElement) {
        // Remove internal tag elements, keep plain text
        // Copy node content instead of using innerHTML to avoid HTML tags
        Array.from(contentElement.childNodes).forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            content += node.textContent;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // If it's a tag node and not an a tag (tag link), add content
            if ((node as Element).tagName !== 'A') {
              content += node.textContent;
            }
          }
        });
      }
      content = content.trim();
      
      // Get author information
      const authorElement = document.querySelector('.author-wrapper .username');
      const author = authorElement ? authorElement.textContent?.trim() || '' : '';
      
      // Try to get author description (if exists)
      const authorDescElement = document.querySelector('.user-desc');
      const authorDesc = authorDescElement ? authorDescElement.textContent?.trim() : undefined;
      
      // Get image list
      const imageElements = document.querySelectorAll('.note-slider-img');
      const images = Array.from(imageElements).map(img => (img as HTMLImageElement).src);
      
      // Get interaction data: likes, favorites, comments count
      const interactionButtons = document.querySelectorAll('.engage-bar-style .count');
      let likes = 0, collects = 0, comments = 0;
      
      if (interactionButtons.length >= 3) {
        const likesText = interactionButtons[0].textContent?.trim() || '0';
        const collectsText = interactionButtons[1].textContent?.trim() || '0';
        const commentsText = interactionButtons[2].textContent?.trim() || '0';
        
        // Handle special text like "赞", convert to numbers
        likes = likesText === '赞' ? 0 : parseInt(likesText) || 0;
        collects = collectsText === '收藏' ? 0 : parseInt(collectsText) || 0;
        comments = commentsText === '评论' ? 0 : parseInt(commentsText) || 0;
      }
      
      // Get tag list
      const tagElements = document.querySelectorAll('#detail-desc .tag');
      const tags = Array.from(tagElements).map(tag => tag.textContent?.trim() || '');
      
      return {
        title,
        content,
        author,
        authorDesc,
        images,
        likes,
        collects,
        comments,
        tags
      };
    });
  } catch (error) {
    console.error('Failed to extract note detail data:', error);
    return {
      title: '',
      content: '',
      author: '',
      images: [],
      likes: 0,
      collects: 0,
      comments: 0,
      tags: []
    };
  }
}

// Get note comment data (optional)
async function getComments(page: Page, maxComments: number = 5): Promise<Array<{
  author: string;
  content: string;
  likes: number;
  images?: string[];
}>> {
  try {
    return await page.evaluate((max) => {
      const commentItems = document.querySelectorAll('.parent-comment .comment-item');
      const comments = [];
      
      for (let i = 0; i < Math.min(commentItems.length, max); i++) {
        const item = commentItems[i];
        const authorElement = item.querySelector('.author .name');
        const contentElement = item.querySelector('.content .note-text');
        const likesElement = item.querySelector('.like .count');
        
        // Get images in comments (if any)
        const imageElements = item.querySelectorAll('.comment-picture img');
        const images = Array.from(imageElements).map(img => (img as HTMLImageElement).src);
        
        if (authorElement && contentElement) {
          const author = authorElement.textContent?.trim() || '';
          const content = contentElement.textContent?.trim() || '';
          const likesText = likesElement?.textContent?.trim() || '0';
          const likes = likesText === '赞' ? 0 : parseInt(likesText) || 0;
          
          comments.push({
            author,
            content,
            likes,
            ...(images.length > 0 ? { images } : {})
          });
        }
      }
      
      return comments;
    }, maxComments);
  } catch (error) {
    console.error('Failed to extract comment data:', error);
    return [];
  }
}

// Extract note links from page
async function extractNoteLinks(page: Page, count: number): Promise<Array<{title: string, link: string, author: string}>> {
  try {
    const links = await page.evaluate((maxCount) => {
      const noteElements = Array.from(document.querySelectorAll('.note-item'));
      return noteElements.slice(0, maxCount).map(element => {
        try {
          // Extract title
          const titleElement = element.querySelector('.title span') as HTMLElement;
          
          // Extract link - try to get visible link first, then hidden link
          const visibleLinkElement = element.querySelector('a.cover.mask') as HTMLAnchorElement;
          const hiddenLinkElement = element.querySelector('a[style="display: none;"]') as HTMLAnchorElement;
          
          // Extract author
          const authorElement = element.querySelector('.card-bottom-wrapper .name span.name') as HTMLElement;
          
          return {
            title: titleElement ? titleElement.innerText.trim() : 'No Title',
            // Link path processing: ensure link is complete URL
            link: (visibleLinkElement?.href || hiddenLinkElement?.href || '')
              .replace(/^\//, 'https://www.xiaohongshu.com/'),
            author: authorElement ? authorElement.innerText.trim() : 'Unknown Author'
          };
        } catch (error) {
          console.error('Error extracting note link', error);
          return null;
        }
      });
    }, count);
    
    // Explicitly filter out null values and satisfy TypeScript type checking
    return links.filter((item): item is {title: string, link: string, author: string} => 
      item !== null && typeof item === 'object' && 'link' in item && !!item.link);
  } catch (error) {
    console.error('Failed to extract note links:', error);
    return [];
  }
}

// Get individual note details based on user-defined count
async function getNoteDetail(context: BrowserContext, noteInfo: {title: string, link: string, author: string}, index: number): Promise<RedBookNote> {
  let notePage: Page | null = null;
  
  try {
    console.error(`Starting to get note ${index + 1} details: ${noteInfo.title}`);
    notePage = await context.newPage();
    
    // Set longer timeout
    await notePage.goto(noteInfo.link, { 
      timeout: 30000,
      waitUntil: 'domcontentloaded'
    });
    
    // Wait for page to load completely
    await notePage.waitForSelector('#noteContainer', { timeout: 15000 })
      .catch(() => console.error('Note container not found, trying to continue getting content'));
    
    // Get detailed data
    const detailData = await getNoteDetailData(notePage);
    
    // // Can save screenshot for debugging
    // await notePage.screenshot({ path: `note-${index + 1}.png` });
    
    // Build complete note object
    return {
      title: detailData.title || noteInfo.title,
      content: detailData.content || 'No content',
      author: detailData.author || noteInfo.author,
      authorDesc: detailData.authorDesc,
      link: noteInfo.link,
      likes: detailData.likes,
      collects: detailData.collects,
      comments: detailData.comments,
      // Add enhanced data
      tags: detailData.tags,
      images: detailData.images
    };
  } catch (error) {
    console.error(`Failed to get note ${index + 1} details:`, error);
    // Return basic information when error occurs
    return {
      title: noteInfo.title,
      content: 'Failed to get content',
      author: noteInfo.author,
      link: noteInfo.link
    };
  } finally {
    // Ensure tab is closed
    if (notePage) {
      await notePage.close().catch(err => console.error('Error closing tab:', err));
    }
  }
}

// Extract note content from search page
async function extractNotes(page: Page, count: number, context: BrowserContext): Promise<RedBookNote[]> {
  try {
    // Get note links list
    const noteLinks = await extractNoteLinks(page, count);
    console.error(`Found ${noteLinks.length} notes, starting parallel content retrieval`);
    
    if (noteLinks.length === 0) {
      console.error('No note links found, returning empty result');
      return [];
    }
    
    // Control concurrency to avoid too many concurrent requests causing blocks
    const concurrency = Math.min(3, noteLinks.length);
    console.error(`Setting concurrency to ${concurrency}`);
    
    // Create task queue
    const queue = [...noteLinks];
    const results: RedBookNote[] = [];
    
    // Start concurrency number of tasks simultaneously
    const workers = Array(concurrency).fill(null).map(async (_, workerIndex) => {
      while (queue.length > 0) {
        const noteInfo = queue.shift();
        if (!noteInfo) break;
        
        const index = noteLinks.indexOf(noteInfo);
        console.error(`Worker ${workerIndex+1} processing note ${index+1}`);
        
        try {
          // Slightly stagger time between workers to reduce simultaneous requests
          await new Promise(resolve => setTimeout(resolve, workerIndex * 1000));
          
          const note = await getNoteDetail(context, noteInfo, index);
          if (note) {
            results[index] = note; // Maintain original order
          }
          
          // Interval between requests to avoid too frequent requests
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`Failed to process note ${index+1}:`, error);
        }
      }
    });
    
    // Wait for all workers to complete
    await Promise.all(workers);
    
    // Filter out undefined results and return
    return results.filter(note => note !== undefined);
  } catch (error) {
    console.error('Failed to extract note content:', error);
    return [];
  }
}

// Perform search
async function performSearch(page: Page, keyword: string, count: number, context: BrowserContext): Promise<void> {
  // Set longer timeout and better waiting strategy
  await page.goto(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`, {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  // Wait for page to load
  await page.waitForSelector('.feeds-container', { timeout: 15000 }).catch(() => {
    console.error('Note list container not found, trying to wait longer');
    return page.waitForTimeout(5000);
  });

  // If need to get more content, scroll page
  if (count > 6) {
    await autoScroll(page);
  }
}

// Search Xiaohongshu content function
export async function searchXiaohongshu(query: string, count: number = 5): Promise<RedBookNote[]> {
  let browser: Browser | null = null;
  
  try {
    const searchKeyword = query;
    console.error(`Search keyword: ${searchKeyword}`);
    
    // Check if login is needed
    const needLogin = !await cookiesExist();
    
    // Create browser instance
    browser = await chromium.launch({
      headless: !needLogin, // If login needed, show browser
    });
    
    if (needLogin) {
      // Handle login process
      const loginSuccess = await handleLogin(browser);
      if (!loginSuccess) {
        throw new Error('User login failed, unable to continue search');
      }
    }
      
    await browser.close();
    
    browser = await chromium.launch({ headless: true });

    // Create new context for search
    let context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });
    
    // Load cookies
    await loadCookies(context);
    
    // Create page
    let page = await context.newPage();
    
    // Verify login status
    await page.goto('https://www.xiaohongshu.com/explore');
    await page.waitForTimeout(5000);
    
    const isLoggedIn = await checkLoginStatus(page);
    
    if (!isLoggedIn) {
      console.error('Cookies expired or invalid, need to login again');
      
      // Close current browser context
      await context.close();
      
      // Need to change browser headless mode, close browser first
      await browser.close();
      
      // Restart browser in headed mode
      browser = await chromium.launch({ headless: false });
      
      // Login again
      const loginSuccess = await handleLogin(browser);
      if (!loginSuccess) {
        throw new Error('User login failed, unable to continue search');
      }

      await context.close();
      
      await browser.close();
      
      browser = await chromium.launch({ headless: true });
      
      // After successful login, create new search context
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      });
      
      // Load latest cookies
      await loadCookies(context);
      
      // Create new page
      page = await context.newPage();
    }
    
    // Already logged in, proceed with search
    await performSearch(page, searchKeyword, count, context);
    
    // Get search results - pass context parameter
    const notes = await extractNotes(page, count, context);
    
    // Save latest cookies
    await saveCookies(context);
    
    return notes;
  } catch (error) {
    console.error('Error searching Xiaohongshu:', error);
    throw error;
  } finally {
    // Ensure browser is closed
    if (browser) {
      await browser.close();
    }
  }
}

// Handle login process
async function handleLogin(browser: Browser): Promise<boolean> {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  
  let page;
  
  try {
    page = await context.newPage();
    
    // Visit Xiaohongshu homepage
    await page.goto('https://www.xiaohongshu.com/explore');
    await page.waitForTimeout(5000);
    
    console.error('Please login to Xiaohongshu in the browser, system will automatically detect login status');
    
    // Wait for user login operation to complete
    let isLoggedIn = false;
    
    // Check login status every 2 seconds, wait up to 5 minutes
    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      isLoggedIn = await checkLoginStatus(page);
      if (isLoggedIn) {
        console.error('Successfully logged in detected');
        break;
      }
    }
    
    if (isLoggedIn) {
      // Save cookies
      await saveCookies(context);
      return true;
    } else {
      console.error('Login timeout, please try again');
      return false;
    }
  } catch (error) {
    console.error('Error during user login process:', error);
    return false;
  } finally {
    if (page) await page.close();
    await context.close();
  }
}

// Add function to save note data to JSON file
async function saveNotesToFile(notes: RedBookNote[], keyword: string): Promise<void> {
  try {
    // Create results directory
    const resultsDir = path.join(process.cwd(), 'results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    // Generate filename (use timestamp to avoid overwriting)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${resultsDir}/xiaohongshu_${encodeURIComponent(keyword)}_${timestamp}.json`;
    
    // Write data to file
    await fs.writeFile(fileName, JSON.stringify(notes, null, 2), 'utf-8');
    console.error(`Note data saved to file: ${fileName}`);
  } catch (error) {
    console.error('Error saving note data to file:', error);
  }
}