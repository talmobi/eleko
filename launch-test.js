const electron = require( 'electron' )
const eleko = require( './index.js' )

const nfzf = require( 'node-fzf' )
const redstar = require( 'redstar' )

const fs = require( 'fs' )
const path = require( 'path' )

main()

async function main ()
{
  const mainWindow = await eleko.launch()
  const userAgent = await mainWindow.call( 'webContents.session.getUserAgent' )
  console.log( userAgent )
}
