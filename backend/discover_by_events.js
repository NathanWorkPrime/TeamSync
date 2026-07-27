require('dotenv').config();
const pat = process.env.GITHUB_PAT;

fetch('https://api.github.com/users/NathanWorkPrime/events', {
  headers: {
    'Authorization': `token ${pat}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TeamSync-App'
  }
})
.then(res => res.json())
.then(data => {
  console.log("Events length:", data.length);
  if (Array.isArray(data)) {
    const repos = new Set();
    data.forEach(e => {
      if (e.repo) {
        repos.add(e.repo.name);
      }
    });
    console.log("Recently active repos in events:");
    repos.forEach(r => console.log(`- ${r}`));
  } else {
    console.log("Events Data:", data);
  }
})
.catch(err => console.error(err));
