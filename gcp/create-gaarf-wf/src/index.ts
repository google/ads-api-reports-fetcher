#!/usr/bin/env node
/* eslint-disable no-process-exit */

import * as fs from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import child_process from 'child_process';
import minimist from 'minimist';
import inquirer from 'inquirer';
import prompts, {PromptType} from 'prompts';
import figlet from 'figlet';
import chalk from 'chalk';
import clui from 'clui';

//import fetch from "node-fetch";

const execSync = child_process.execSync;
const spawn = child_process.spawn;

const GIT_REPO = 'https://github.com/google/ads-api-report-fetcher.git';
const LOG_FILE = '.create-gaarf-wf-out.log';

const argv = minimist(process.argv.slice(2));
const is_diag = argv.diag;
const is_debug = argv.debug || argv.diag;

// First argument (optional) is a path where the tool run in.
const cwd = get_cwd(argv);

function get_cwd(argv: minimist.ParsedArgs) {
  let cwd = argv._[0];
  if (cwd) {
    if (!path.isAbsolute(cwd)) {
      cwd = path.resolve(process.cwd(), cwd);
    }
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd);
    }
    process.chdir(cwd);
  } else {
    cwd = process.cwd();
  }
  return cwd;
}

function deploy_shell_script(fileName: string, content: string) {
  fs.writeFileSync(fileName, content);
  execSync(`chmod +x ${fileName}`);
  console.log(chalk.gray(`Created ${fileName}`));
}

function exec_cmd(
  cmd: string,
  spinner?: clui.Spinner | undefined | null,
  options?: {realtime?: boolean; silent?: boolean; keep_output?: boolean}
): Promise<{code: number; stderr: string; stdout: string}> {
  options = options || {};
  if (spinner && options.realtime === undefined) {
    // having a spinner and streaming stdout at the same looks bad
    options.realtime = false;
  }
  if (is_diag) {
    options.keep_output = true;
  }
  if (spinner) spinner.start();
  if (is_debug) {
    console.log(chalk.gray(cmd));
    fs.appendFileSync(LOG_FILE, `[${new Date()}] Running ${cmd}`);
  }
  const cp = spawn(cmd, [], {
    shell: true,
    // inherit stdin, and wrap stdout/stderr
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  return new Promise(resolve => {
    let stderr = '';
    let stdout = '';
    cp.stderr?.on('data', chunk => {
      stderr += chunk;
      if (options?.realtime) process.stderr.write(chunk);
    });
    cp.stdout?.on('data', chunk => {
      stdout += chunk;
      if (options?.realtime) process.stdout.write(chunk);
    });
    cp.on('close', (code: number) => {
      if (spinner) spinner.stop();
      if (!spinner && options?.realtime && !options?.keep_output) {
        // if there's no spinner and keep_output=false, remove all output of the command
        const terminal_width = process.stdout.columns;
        let lines = (stdout ? stdout.split(os.EOL) : []).concat(
          stderr ? stderr.split(os.EOL) : []
        );
        lines = lines.map(line => {
          const arr = line.split('\r');
          return arr[arr.length - 1];
        });
        const row_count = lines
          .map(line => ((line.length / terminal_width) | 0) + 1)
          .reduce((total, count) => (total += count));
        process.stdout.cursorTo(0);
        process.stdout.moveCursor(0, -row_count + 1);
        process.stdout.clearScreenDown();
      }
      if (stderr && !options?.realtime && !options?.silent && code !== 0) {
        // by default, if not switched off and not realtime output, show error
        console.log(stderr);
      }
      if (is_debug) {
        fs.appendFileSync(
          LOG_FILE,
          `[${new Date()}] ${cmd} return ${code} exit code`
        );
        fs.appendFileSync(LOG_FILE, stdout);
        fs.appendFileSync(LOG_FILE, stderr);
      }
      resolve({
        code,
        stderr: stderr || '',
        stdout: stdout || '',
      });
    });
  });
}

async function initialize_gcp_project() {
  // check for gcloud
  const gcloud_res = await exec_cmd('which gcloud', null, {silent: true});
  const gcloud_path = gcloud_res.stdout.trim();
  if (gcloud_res.code !== 0 || !fs.existsSync(gcloud_path)) {
    console.log(
      chalk.red(
        'Could not find gcloud command, please make sure you installed Google Cloud SDK'
      ) +
        ' - see ' +
        chalk.blue('https://cloud.google.com/sdk/docs/install')
    );
    process.exit(-1);
  }
  // now check for authentication in gcloud
  const auth_output = execSync('gcloud auth print-access-token')
    .toString()
    .trim();
  if (auth_output.includes('ERROR: (gcloud.auth.print-access-token)')) {
    console.log(
      chalk.red('Please authenticate in gcloud using ') +
        chalk.white('gcloud auth login')
    );
    process.exit(-1);
  }
  let gcp_project_id = execSync('gcloud config get-value project 2> /dev/null')
    .toString()
    .trim();
  if (gcp_project_id) {
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'use_current_project',
        message: `Detected currect GCP project ${chalk.green(
          gcp_project_id
        )}, do you want to use it (Y) or choose another (N)?:`,
        default: true,
      },
    ]);
    if (answers.use_current_project) {
      return gcp_project_id;
    }
  }
  // otherwise let the user to choose a project
  const projects_csv = child_process
    .execSync(
      'gcloud projects list --format="csv(projectId,projectName)" --sort-by=projectId --limit=500'
    )
    .toString();
  const rows = projects_csv.split('\n').map(row => row.split(','));
  rows.splice(0, 1); // remove header row
  let options = rows
    .filter((cols: string[]) => !!cols[0])
    .map(row => {
      return {
        title: row[0] + (row[1] ? ' (' + row[1] + ')' : ''),
        value: row[0],
      };
    });
  const MANUAL_ITEM = '__MANUAL__';
  options = [{title: 'Enter manually', value: MANUAL_ITEM}].concat(options);
  let response = await prompts({
    type: 'autocomplete',
    name: 'project_id',
    message: 'Please choose a GCP project',
    choices: options,
  });
  gcp_project_id = response.project_id;
  if (response.project_id === MANUAL_ITEM) {
    response = await prompts({
      type: 'text',
      name: 'project_id',
      message: 'Please enter a GCP project id',
    });
    // make sure the entered project does exist
    const describe_output = execSync(
      `gcloud projects describe ${response.project_id}`
    ).toString();
    if (describe_output.includes('ERROR:')) {
      console.log(chalk.red('Could not set current project'));
      console.log(describe_output);
      process.exit(-1);
    }
  }
  gcp_project_id = response.project_id;
  if (gcp_project_id) {
    execSync('gcloud config set project ' + gcp_project_id);
  }
  return gcp_project_id;
}

function getMacroValues(folder_path: string) {
  const filelist = fs.readdirSync(folder_path);
  const macro: Record<string, null> = {};
  for (const name of filelist) {
    if (name.endsWith('.sql')) {
      const file_path = path.join(folder_path, name);
      const script_content = fs.readFileSync(file_path, 'utf-8');
      const matches = [...script_content.matchAll(/\{(?<macro>[^}]+)\}/gi)];
      for (const match of matches) {
        if (match.groups) {
          macro[match.groups['macro']] = null;
        }
      }
    }
  }
  const options = Object.keys(macro).map(name => {
    return {type: <PromptType>'text', name: name, message: name};
  });
  if (options.length) {
    console.log(
      `Please enter values for the following macros found in your scripts in '${folder_path}' folder`
    );
    console.log(
      chalk.yellow('Tip: ') +
        chalk.gray(
          'beside constants you can use :YYYYMMDD-N values and expressions (${..})'
        )
    );
    return inquirer.prompt(options);
  }
  return {};
}

async function init() {
  // TODO:
  //  support an argument with config file with all answerts
  //  search for a config auto-saved from last run, if found initialize all settings from it and skip questions
  //  ask for memory and region for CF/WF
  if (is_debug) {
    fs.writeFileSync(
      LOG_FILE,
      `[${new Date()}] Running create-gaarf-wf in ${cwd}`
    );
  }
  console.log(chalk.gray(`Running create-gaarf-wf in ${cwd}`));
  console.log(
    chalk.yellow(figlet.textSync('Gaarf Workflow', {horizontalLayout: 'full'}))
  );
  console.log(
    'Welcome to interactive generator for Gaarf Workflow (Google Ads API Report Fetcher Workflow)'
  );
  console.log(
    'You will be asked a bunch of questions to prepare and initialize your cloud infrastructure'
  );
  console.log(
    'It is best to run this script in a folder that is a parent for your queries'
  );

  const gcp_project_id = await initialize_gcp_project();

  let answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Your project name (no spaces):',
      default: path.basename(cwd),
      filter: value => {
        return value.replaceAll(' ', '_');
      },
    },
  ]);
  const name = answers.name;

  answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'path_to_ads_queries',
      message: 'Relative path to a folder with your Ads queries:',
      default: 'ads-queries',
    },
    {
      type: 'input',
      name: 'path_to_bq_queries',
      message: 'Relative path to a folder with your BigQuery queries:',
      default: 'bq-queries',
    },
    {
      type: 'input',
      name: 'gcs_bucket',
      message: 'GCP bucket name for queries:',
      default: gcp_project_id,
      filter: value => {
        return value.startsWith('gs://')
          ? value.substring('gs://'.length)
          : value;
      },
    },
    {
      type: 'input',
      name: 'path_to_googleads_config',
      message: 'Relative path to your google-ads.yaml:',
      default: 'google-ads.yaml',
    },
  ]);
  const path_to_ads_queries = answers.path_to_ads_queries;
  const path_to_ads_queries_abs = path.join(cwd, path_to_ads_queries);
  const path_to_bq_queries = answers.path_to_bq_queries;
  const path_to_bq_queries_abs = path.join(cwd, path_to_bq_queries);
  let gcs_bucket = answers.gcs_bucket;
  const path_to_googleads_config = answers.path_to_googleads_config;
  if (!fs.existsSync(path_to_ads_queries_abs)) {
    fs.mkdirSync(path_to_ads_queries_abs);
    console.log(chalk.grey(`Created '${path_to_ads_queries_abs}' folder`));
  }
  if (!fs.existsSync(path_to_bq_queries_abs)) {
    fs.mkdirSync(path_to_bq_queries_abs);
    console.log(chalk.grey(`Created '${path_to_bq_queries_abs}' folder`));
  }

  gcs_bucket = (gcs_bucket || gcp_project_id).trim();

  // clone gaarf repo
  const gaarf_folder = 'ads-api-fetcher';
  if (!fs.existsSync(gaarf_folder)) {
    await exec_cmd(
      `git clone ${GIT_REPO} --depth 1 ${gaarf_folder}`,
      new clui.Spinner(`Cloning Gaarf repository (${GIT_REPO}), please wait...`)
    );
  } else {
    execSync(`cd ${gaarf_folder} && git pull`);
  }

  // create a bucket
  const res = await exec_cmd(
    `gsutil mb -b on gs://${gcs_bucket}`,
    new clui.Spinner(`Creating a GCS bucket ${gcs_bucket}`),
    {silent: true}
  );
  if (
    !res.stderr.includes(
      `ServiceException: 409 A Cloud Storage bucket named '${gcp_project_id}' already exists`
    )
  ) {
    console.log(chalk.red(`Could not create a bucket ${gcs_bucket}`));
    console.log(res.stderr);
  }

  // Create deploy-scripts.sh
  deploy_shell_script(
    'deploy-scripts.sh',
    `# Deploy Ads and BQ scripts from local folders to Goggle Cloud Storage.
GCS_BUCKET=gs://${gcs_bucket}
GCS_BASE_PATH=$GCS_BUCKET/${name}

gsutil -m cp ${path_to_googleads_config} $GCS_BASE_PATH/google-ads.yaml

gsutil rm -r $GCS_BASE_PATH/${path_to_ads_queries}
gsutil -m cp -R ./${path_to_ads_queries}/* $GCS_BASE_PATH/ads-queries/

gsutil rm -r $GCS_BASE_PATH/${path_to_bq_queries}
gsutil -m cp -R ./${path_to_bq_queries}/* $GCS_BASE_PATH/bq-queries/
`
  );

  const workflow_name = name + '-wf';

  // Create deploy-wf.sh
  deploy_shell_script(
    'deploy-wf.sh',
    `# Deploy Cloud Functions and Cloud Workflow
cd ./${gaarf_folder}/gcp/functions
./setup.sh -n ${name}
cd ../workflow
./setup.sh -n ${workflow_name}
`
  );

  const has_ads_queries = !!fs.readdirSync(path_to_ads_queries).length;
  const has_bq_queries = !!fs.readdirSync(path_to_bq_queries).length;
  const has_adsconfig = fs.existsSync(path_to_googleads_config);
  const ready_to_deploy_scripts =
    !!gcp_project_id && has_ads_queries && has_bq_queries && has_adsconfig;
  if (!has_ads_queries || !has_bq_queries) {
    console.log(
      chalk.red(
        `Please place your ads/bq scripts into '${path_to_ads_queries}' and '${path_to_ads_queries}' folders accordinally`
      )
    );
  }
  if (!has_adsconfig) {
    console.log(
      chalk.red(
        `Please put your Ads config into '${path_to_googleads_config}' file`
      )
    );
  }
  const progress = {
    scripts_deployed: false,
    wf_created: false,
    wf_scheduled: false,
  };

  if (ready_to_deploy_scripts) {
    if (
      (
        await inquirer.prompt({
          type: 'confirm',
          name: 'deploy_scripts',
          message: 'Do you want to deploy scripts (Ads/BQ) to GCS:',
          default: true,
        })
      ).deploy_scripts
    ) {
      await exec_cmd(path.join(cwd, './deploy-scripts.sh'), null, {
        realtime: true,
      });
      progress.scripts_deployed = true;
    }
  }

  answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'deploy_wf',
      message: 'Do you want to deploy Cloud components:',
      default: true,
    },
  ]);
  if (answers.deploy_wf) {
    await exec_cmd(
      path.join(cwd, './deploy-wf.sh'),
      new clui.Spinner('Deploying Cloud components, please wait...')
    );
    progress.wf_created = true;
  }

  // now we need parameters for running the WF
  answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'output_dataset',
      message: 'BigQuery dataset for ads queries results:',
      default: name + '_ads',
    },
    {
      type: 'input',
      name: 'customer_id',
      message: 'Ads account id (customer id, without dashes):',
    },
  ]);

  // now we detect macro used in queries and ask for their values
  const macro_ads = await getMacroValues(path.join(cwd, path_to_ads_queries));
  const macro_bq = await getMacroValues(path.join(cwd, path_to_bq_queries));

  const output_dataset = answers.output_dataset;
  const customer_id = answers.customer_id;
  const wf_data = {
    cloud_function: name,
    gcs_bucket: gcs_bucket,
    ads_queries_path: `${name}/${path_to_ads_queries}/`,
    bq_queries_path: `${name}/${path_to_bq_queries}/`,
    dataset: output_dataset,
    cid: customer_id,
    ads_config_path: `gs://${gcs_bucket}/gaarf/google-ads.yaml`,
    bq_dataset_location: '',
    ads_macro: macro_ads,
    bq_macro: macro_bq,
    bq_sql: {},
  };

  // Create run-wf.sh
  deploy_shell_script(
    'run-wf.sh',
    `gcloud workflows run ${workflow_name} \
  --data='${JSON.stringify(wf_data, null, 2)}'
`
  );

  answers = await inquirer.prompt([
    {
      when: progress.scripts_deployed && progress.wf_created,
      type: 'confirm',
      name: 'schedule_wf',
      message: 'Do you want to schedule a job for executing workflow:',
      default: true,
    },
  ]);
  let schedule = '0 0 * * *';
  if (answers.schedule_wf) {
    const answers_schedule = await inquirer.prompt([
      {
        type: 'input',
        name: 'schedule',
        message: 'Enter time (hh:mm):',
        default: '00:00',
        validate: (input: string) =>
          !input.match(/\d+(:\d+)*/gi) ? 'Please use the format 00:00' : true,
      },
    ]);
    const time_parts = answers_schedule.schedule.split(':');
    schedule = `${time_parts.length > 1 ? time_parts[1] : 0} ${
      time_parts[0]
    } * * *`;
  }
  // Create schedule-wf.sh
  deploy_shell_script(
    'schedule-wf.sh',
    `# Create Scheduler Job to execute Cloud Workflow
PROJECT_ID=${gcp_project_id}
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="csv(projectNumber)" | tail -n 1)
# be default Cloud Worflows run under the Compute Engine default service account:
SERVICE_ACCOUNT=$PROJECT_NUMBER-compute@developer.gserviceaccount.com

REGION=us-central1
WORKFLOW_NAME=${workflow_name}
JOB_NAME=$WORKFLOW_NAME

data='${JSON.stringify(wf_data, null, 2).replaceAll('"', '\\"')}'

gcloud scheduler jobs delete $JOB_NAME --location $REGION --quiet

# daily at midnight
gcloud scheduler jobs create http $JOB_NAME \\
  --schedule="${schedule}" \\
  --uri="https://workflowexecutions.googleapis.com/v1/projects/$PROJECT_ID/locations/$REGION/workflows/$WORKFLOW_NAME/executions" \
  --location=$REGION \\
  --message-body="{\\"argument\\": \\"$data\\"}" \\
  --oauth-service-account-email="$SERVICE_ACCOUNT" \\
  --time-zone="Etc/UTC"

#  --time-zone="TIME_ZONE" \
# timezone: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
`
  );

  if (answers.schedule_wf) {
    const res = await exec_cmd(
      path.join(cwd, './schedule-wf.sh'),
      new clui.Spinner('Creating a Scheduler Job, please wait...')
    );
    if (res.code === 0) {
      console.log(
        'Created a Scheduler Job. You can recreate it with different settings by running schedule-wf.sh'
      );
    }
    progress.wf_scheduled = true;
  }

  // creating scripts for directly running gaarf
  const ads_macro_clistr = Object.entries(macro_ads)
    .map(macro => `--macro.${macro[0]}=${macro[1]}`)
    .join(' ');
  deploy_shell_script(
    'run-gaarg-console.sh',
    `${gaarf_folder}/js/gaarf ${path_to_ads_queries}/*.sql --account=${customer_id} --ads-config=${path_to_googleads_config} --output=console --console.transpose=always ${ads_macro_clistr}`
  );
  deploy_shell_script(
    'run-gaarf.sh',
    `${gaarf_folder}/js/gaarf ${path_to_ads_queries}/*.sql --account=${customer_id} --ads-config=${path_to_googleads_config} --output=bq --bq.project=${gcp_project_id} --bq.dataset=${output_dataset} ${ads_macro_clistr}`
  );
  const bq_macro_clistr = Object.entries(macro_bq)
    .map(macro => `--macro.${macro[0]}=${macro[1]}`)
    .join(' ');
  deploy_shell_script(
    'run-gaarf-bq.sh',
    `${gaarf_folder}/js/gaarf-bq ${path_to_bq_queries}/*.sql --project=${gcp_project_id} ${bq_macro_clistr}`
  );

  console.log(chalk.green('All done'));

  console.log(chalk.yellow('Tips for using the generated scripts:'));
  console.log(
    ` 🔹 ${chalk.blue(
      'deploy-scripts.sh'
    )} - redeploy queries and google-ads.yaml to GCS`
  );
  console.log(
    ` 🔹 ${chalk.blue('deploy-wf.sh')} - redeploy Cloud Functions and Workflow`
  );
  console.log(
    ` 🔹 ${chalk.blue(
      'run-wf.sh'
    )} - execute workflow directly, see arguments inside`
  );
  console.log(
    ` 🔹 ${chalk.blue(
      'schedule-wf.sh'
    )} - reschedule workflow execution, see arguments inside`
  );
  console.log(
    ` 🔹 ${chalk.blue(
      'run-gaarf-*.sh'
    )} - scripts for direct query execution via gaarf (via command line)`
  );

  /* save everything to a config
  `
  GCS_BUCKET: ${gcs_bucket}
  GCS_BASE_PATH: ${name}
  ADS_SCRIPTS_FOLDER: ${path_to_ads_queries}
  BQ_SCRIPTS_FOLDER: ${path_to_bq_queries}
  LOCALTION: us-central1
  GAARF_FUNCTION: ${name}
  GAARF_BQ_FUNCTION: ${name}-bq
  WORKFLOW: ${name}-wf
  ADS_CONFIG: ${path_to_googleads_config}
  BQ_DATASET: ${output_dataset}
  BQ_DATASET_LOCATION: europe
  ADS_MACRO:
  BQ_MACRO:
  `;
  */
}

init().catch(e => {
  console.error(e);
});

/*
TODO:
- support git repo url as argument
 */