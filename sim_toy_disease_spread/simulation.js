var global = {
	running: false,
	simulation: undefined,
	ui: {}
}

const COLOR_HEALTHY   = "#00008880"
const COLOR_SICK      = "#88000080"
const COLOR_RECOVERED = "#00880080"

const STATUS_HEALTHY   = 0
const STATUS_SICK      = 1
const STATUS_RECOVERED = 2

//
// have a button to start the simulation
// fixed population
//     same dynamics
//

//
// health_status: indicates the iteration where it subject 
// was first contaminated. Zero means patient was never
// contaminated
//
// subject is healty and does not contagious when health
// status is either zero or the 
//
//       iteration - health_status >= recovery_steps
//

function aux_health_status_(hs, iteration, recovery_steps)
{
	if (hs == 0) { return STATUS_HEALTHY }
	else if (iteration - hs < recovery_steps) { return STATUS_SICK }
	else { return STATUS_RECOVERED }
}

function simulation_update_interactions(simulation)
{

	let new_in_contact_with = []
	for (let i=0;i<simulation.n;++i) {
		new_in_contact_with.push([])
	}

	// quadratic search for interactions
	for (let i=0;i<simulation.n;i++) {
		let subject_i = simulation.subjects[i]
		for (let j=i+1;j<simulation.n;j++) {
			let subject_j = simulation.subjects[j]
			let dx = subject_i.px - subject_j.px
			let dy = subject_i.py - subject_j.py
			let d2 = dx * dx + dy * dy
			if (d2 <= simulation.hit_distance2) {
				new_in_contact_with[i].push(j)
				new_in_contact_with[j].push(i)
				// console.log("contact: " + i + " x " + j)
			}
		}
	}

	let new_interactions   = 0

	// check for each subject the new interactions found and
	// update their health status based on these interactions
	function new_interaction(index_subject_a, index_subject_b) {
		// console.log("interaction: " + index_subject_a + " x " + index_subject_b)
		let subject_a = simulation.subjects[index_subject_a]
		let subject_b = simulation.subjects[index_subject_b]

		++new_interactions

		let coin_flip = Math.random()

		// same dynamic with different parameters
		// update the status of each simulation
		for (let i=0;i<simulation.m;++i) {
			let recovery_steps_index = Math.floor(i / simulation.contagion_probs.length)
			let infection_rate_index = i % simulation.contagion_probs.length
			let recovery_steps = simulation.recovery_steps[recovery_steps_index]
			let infection_rate = simulation.contagion_probs[infection_rate_index]

			let subject_a_status = aux_health_status_(subject_a.health_status[i], simulation.iteration, recovery_steps)
			let subject_b_status = aux_health_status_(subject_b.health_status[i], simulation.iteration, recovery_steps)

			if (subject_a_status == STATUS_HEALTHY && subject_b_status == STATUS_SICK) {
				// b might contaminate a now
				let contaminate = coin_flip <= infection_rate
				if (contaminate) {
					subject_a.health_status[i] = simulation.iteration
				}
			} else if (subject_a_status == STATUS_SICK && subject_b_status == STATUS_HEALTHY) {
				// a might contaminate b now
				// b might contaminate a now
				let contaminate = coin_flip <= infection_rate
				if (contaminate) {
					subject_b.health_status[i] = simulation.iteration
				}
			}
		}
	}

	for (let i=0;i<simulation.n;i++) {
		let a = simulation.subjects[i].in_contact_with
		let b = new_in_contact_with[i]
		b.sort()

		let ia = 0;
		let ib = 0;
		while (ia < a.length && ib < b.length) {
			if (a[ia] < b[ib]) {
				++ia
			} else if (a[ia] > b[ib]) {
				// a new contact was found
				if (i < b[ib]) {
					new_interaction(i,b[ib])
				}
				++ib
			} else {
				++ia
				++ib
			}
		}
		while (ib < b.length) {
			if (i < b[ib]) {
				new_interaction(i,b[ib])
			}
			++ib
		}
		simulation.subjects[i].in_contact_with = b
	}

	let max_sick_across_config = 0

	let iteration_status = []
	for (let i=0;i<simulation.m;++i) {
		let recovery_steps_index = Math.floor(i / simulation.contagion_probs.length)
		let infection_rate_index = i % simulation.contagion_probs.length
		let recovery_steps = simulation.recovery_steps[recovery_steps_index]
		let infection_rate = simulation.contagion_probs[infection_rate_index]

		let healthy = 0
		let sick = 0
		let recovered = 0

		for (let j=0;j<simulation.n;j++) {
			let subject = simulation.subjects[j]

			let health = aux_health_status_(subject.health_status[i], simulation.iteration, recovery_steps)
			if (health == STATUS_HEALTHY) {
				++healthy
			} else if (health == STATUS_SICK) {
				++sick
			} else {
				++recovered
			}
		}

		iteration_status.push({
			healthy: healthy,
			sick: sick,
			recovered: recovered
		})

		max_sick_across_config = Math.max(max_sick_across_config, sick)

		simulation.max_sick[i] = Math.max(simulation.max_sick[i], sick)

	}

	simulation.history.push(iteration_status)
	simulation.done = max_sick_across_config == 0

	simulation.pairwise_interactions   += new_interactions

}

function simulation_init(n, radius, width, height, contagion_probs, recovery_steps, static_population_ratio)
{
	let m = contagion_probs.length * recovery_steps.length
	let simulation = {
		n:      n, // population size
		width:  width,
		height: height,
		radius: radius,
		hit_distance2: (2*radius) * (2*radius),
		step_length: 1,
		iteration: 1,
		static_population_ratio: static_population_ratio,
		subjects: [],
		m: m,
		contagion_probs: contagion_probs,
		recovery_steps: recovery_steps,
		max_sick: new Array(m).fill(0),
		done: false,
		history: [],
		pairwise_interactions: 0
	}

	let mobile_subjects = Math.round((1.0-static_population_ratio) * n)
	// the sick subject

	for (let i=0;i<n;i++) {
		let vx = 0.0
		let vy = 0.0
		if (i < mobile_subjects) { 
			let theta = Math.random() * Math.PI * 2
			vx = Math.cos(theta)
			vy = Math.sin(theta)
		}

		health_status = (i==0) ? 1 :  0

		simulation.subjects.push( {
			px: Math.random() * simulation.width,
			py: Math.random() * simulation.height,
			vx: vx,
			vy: vy,
			interaction_count: 0,
			in_contact_with: new Set(),
			health_status: new Array(simulation.m).fill(health_status) 
		})
	}


	simulation_update_interactions(simulation)

	return simulation

}

function simulation_move_subjects(simulation)
{
	// simply move the subject around
	for (let i=0;i<simulation.n;i++) {

		let subject = simulation.subjects[i]

		subject.px += subject.vx
		subject.py += subject.vy

		if (subject.px < 0) {
			subject.vx = -subject.vx
			subject.px = -subject.px
		} else if (subject.px >= simulation.width) {
			subject.vx = -subject.vx
			subject.px = simulation.width - (subject.px - simulation.width)
		}

		if (subject.py < 0) {
			subject.vy = -subject.vy
			subject.py = -subject.py
		} else if (subject.py >= simulation.width) {
			subject.vy = -subject.vy
			subject.py = simulation.width - (subject.py - simulation.width)
		}
	}
}

function simulation_step(simulation)
{
	simulation_move_subjects(simulation)
	simulation.iteration++
	simulation_update_interactions(simulation)
}

function render_simulation(simulation)
{
	let canvas = global.ui.main_canvas
	let ctx = canvas.getContext('2d')

	ctx.font = "12 Monaco";

	canvas.width  = window.innerWidth;
	canvas.height = window.innerHeight;

	//
	// TODO make sure we can mix eigher with black or with white
	// satellite images mix better with white
	//
	ctx.beginPath();
	ctx.rect(0, 0, canvas.width, canvas.height);
	ctx.closePath();
	ctx.fillStyle = "black";
	// ctx.fillStyle = "black";
	ctx.fill();

	let hmargin = 20
	let vmargin = 5

	let height_header = 18
	let width_header = simulation.width
	let height_world = simulation.height
	let height_tseries = Math.floor(simulation.height/4)
	let width_tseries = simulation.width
	let width_world = simulation.width
	let width = hmargin + simulation.width
	let height = vmargin + height_header + height_tseries + vmargin + height_world

	let ncol = simulation.contagion_probs.length
	let nrow = simulation.recovery_steps.length

	for (let i=0;i<simulation.m;i++) {
		let row = Math.floor(i / simulation.contagion_probs.length)
		let col = i % simulation.contagion_probs.length

		let infection_rate = simulation.contagion_probs[col]
		let recovery_steps = simulation.recovery_steps[row]

		// x0, y0, width, height
		let header_view   = [ col * width + hmargin, row * height + vmargin, width_header, height_header]
		let tseries_view  = [ col * width + hmargin, row * height + vmargin + height_header , width_tseries, height_tseries ]
		let world_view    = [ col * width + hmargin, row * height + vmargin + height_header + height_tseries + vmargin, width_world, height_world]


		//-----------------
		// Time Series
		//-----------------
	
		// use sampling...

		let iterations = simulation.history.length
		let max_iter = tseries_view[2]


		// let dx = tseries_view[2] / iterations
		let len = Math.min(max_iter, iterations)

		// for perf. factor the three color bars
		ctx.fillStyle = COLOR_HEALTHY
		for (let j=0;j<len;++j) {
			// use first and last
			let index = j 
			if (iterations > max_iter) { index = Math.floor(j/(len-1) * (iterations-1)) }

			let data = simulation.history[index][i]
			let height_healthy   = (data.healthy * tseries_view[3]) / simulation.n
			let height_recovered = (data.recovered * tseries_view[3]) / simulation.n 
			let height_sick = (data.sick * tseries_view[3]) / simulation.n

			ctx.beginPath();
			ctx.rect(tseries_view[0] + j, tseries_view[1], 1, height_healthy);
			ctx.fill();
		}

		ctx.fillStyle = COLOR_RECOVERED
		for (let j=0;j<len;++j) {
			// use first and last
			let index = j 
			if (iterations > max_iter) { index = Math.floor(j/(len-1) * (iterations-1)) }

			let data = simulation.history[index][i]
			let height_healthy   = (data.healthy * tseries_view[3]) / simulation.n
			let height_recovered = (data.recovered * tseries_view[3]) / simulation.n 

			ctx.beginPath();
			ctx.rect(tseries_view[0] + j, tseries_view[1] + height_healthy, 1, height_recovered);
			ctx.fill();
		}

		ctx.fillStyle = COLOR_SICK
		for (let j=0;j<len;++j) {
			// use first and last
			let index = j 
			if (iterations > max_iter) { index = Math.floor(j/(len-1) * (iterations-1)) }

			let data = simulation.history[index][i]
			let height_healthy   = (data.healthy * tseries_view[3]) / simulation.n
			let height_recovered = (data.recovered * tseries_view[3]) / simulation.n 
			let height_sick = (data.sick * tseries_view[3]) / simulation.n 

			ctx.beginPath();
			ctx.rect(tseries_view[0] + j, tseries_view[1] + height_healthy + height_recovered, 1, height_sick);
			ctx.fill();

			if (j == len-1) {

				let inter = simulation.pairwise_interactions

				// write the number
				ctx.textAlign="left"
				let header_text = "it:" + simulation.iteration  + " pi:" + inter + " cp:"+infection_rate+ " rs:" 
					+ recovery_steps + " h:" +data.healthy + " r:" +data.recovered + " s:" +data.sick  + " Ms:" + simulation.max_sick[i]
				ctx.fillStyle = "white"
				ctx.fillText(header_text, header_view[0] + 5, header_view[1] + header_view[3]/2 + 4)
			}
		}

		//-----------------
		// World
		//-----------------
		
		ctx.beginPath();
		ctx.rect(world_view[0], world_view[1], world_view[2], world_view[3]);
		ctx.closePath();
		ctx.fillStyle = "black";
		// ctx.fillStyle = "black";
		ctx.fill();

		ctx.strokeStyle = "#ffffff60";
		//
		for (let j=0;j<simulation.n;++j) {
			let subject = simulation.subjects[j]

			let health = aux_health_status_(subject.health_status[i], simulation.iteration, recovery_steps)

			if (health == STATUS_HEALTHY) {
				// never infected
				ctx.fillStyle = COLOR_HEALTHY
			} else if (health == STATUS_SICK) {
				// sick
				ctx.fillStyle = COLOR_SICK
			} else {
				// recovered
				ctx.fillStyle = COLOR_RECOVERED
			}

			let px = world_view[0] + subject.px
			let py = world_view[1] + subject.py

			let r = simulation.radius

			ctx.beginPath()
			ctx.arc(px,py,r,0,2*Math.PI)
			ctx.closePath()
			ctx.fill()

			if (subject.in_contact_with.length > 0) {
				ctx.stroke()
			}

		}
	}
}

function update()
{
	if (global.simulation) {
		render_simulation(global.simulation)
		if (global.simulation.done) {
			return
		}
	}

	if (global.simulation && global.running) {
		simulation_step(global.simulation)
		setTimeout(update, 16)
	}
}

function reset_simulation()
{
	let population = parseInt(global.ui.population_input.value)
	if (isNaN(population)) {
		alert("Error parsing Population")
		return
	}

	let social_distancing = parseFloat(global.ui.social_distancing_input.value)
	if (isNaN(social_distancing)) {
		alert("Error parsing Social Distancing")
		return
	}

	let radius = parseInt(global.ui.radius_input.value)
	if (isNaN(radius)) {
		alert("Error parsing Radius")
		return
	}

	let panel_size = parseInt(global.ui.panel_size_input.value)
	if (isNaN(panel_size)) {
		alert("Error parsing Panel Size")
		return
	}
	let contagion_probs = global.ui.contagion_probs_input.value.split(" ");
	for (let i=0;i<contagion_probs.length;i++) {
		contagion_probs[i] = parseFloat(contagion_probs[i])
		if (isNaN(contagion_probs[i])) {
			alert("Error parsing contagion prob. use space to separate probs")
			return
		}
	}
	let recovery_steps = global.ui.recovery_steps_input.value.split(" ");
	for (let i=0;i<recovery_steps.length;i++) {
		recovery_steps[i] = parseInt(recovery_steps[i])
		if (isNaN(recovery_steps[i])) {
			alert("Error parsing recovery steps. use space to separate recov. steps")
			return
		}
	}

	// set global simulation
	global.simulation = simulation_init(population, radius, panel_size, panel_size, contagion_probs, recovery_steps, social_distancing)
	global.running = false
}


function main()
{
	// create ui components
	let global = window.global

	// controls_div
	let controls_div = document.createElement('div')
	global.ui.controls_div = controls_div
	controls_div.id = 'controls_div'
	controls_div.style = 'position:absolute; width:200px; height:100%; left:0; background-color: #a0a0a0;'

	let table = controls_div.appendChild(document.createElement('table'))
	global.ui.table = table
	table.style='font-size:10; border-spacing:0px; cellpadding:2px; width: 100%; cellspacing:2'

	{
		// population
		let row = table.appendChild(document.createElement('tr'))
		{
			let col = row.appendChild(document.createElement('td'));
			let label = col.appendChild(document.createElement('label'));
			label.innerText='Population:'
		}
		{
			let col = row.appendChild(document.createElement('td'));
			let population_input = col.appendChild(document.createElement('input'));
			population_input.type = 'text'
			population_input.value = '100'
			global.ui.population_input = population_input
		}
	}

	{
		// infection rates 
		let row = table.appendChild(document.createElement('tr'))
		{
			let col = row.appendChild(document.createElement('td'));
			let label = col.appendChild(document.createElement('label'));
			label.innerText='Contagion Probs:'
		}
		{
			let col = row.appendChild(document.createElement('td'));
			let contagion_probs_input = col.appendChild(document.createElement('input'));
			contagion_probs_input.type = 'text'
			contagion_probs_input.value = '0.125 0.25 0.5 1.0'
			global.ui.contagion_probs_input = contagion_probs_input
		}
	}

	{
		// recovery steps 
		let row = table.appendChild(document.createElement('tr'))
		{
			let col = row.appendChild(document.createElement('td'));
			let label = col.appendChild(document.createElement('label'));
			label.innerText='Recovery Steps (px):'
		}
		{
			let col = row.appendChild(document.createElement('td'));
			let recovery_steps_input = col.appendChild(document.createElement('input'));
			recovery_steps_input.type = 'text'
			recovery_steps_input.value = '250 375'
			global.ui.recovery_steps_input = recovery_steps_input
		}
	}

	{
		// panel size 
		let row = table.appendChild(document.createElement('tr'))
		{
			let col = row.appendChild(document.createElement('td'));
			let label = col.appendChild(document.createElement('label'));
			label.innerText='Social Distancing:'
		}
		{
			let col = row.appendChild(document.createElement('td'));
			let social_distancing_input = col.appendChild(document.createElement('input'));
			social_distancing_input.type = 'text'
			social_distancing_input.value = '0.25'
			global.ui.social_distancing_input = social_distancing_input
		}
	}

	{
		// radius
		let row = table.appendChild(document.createElement('tr'))
		{
			let col = row.appendChild(document.createElement('td'));
			let label = col.appendChild(document.createElement('label'));
			label.innerText='Radius (px):'
		}
		{
			let col = row.appendChild(document.createElement('td'));
			let radius_input = col.appendChild(document.createElement('input'));
			radius_input.type = 'text'
			radius_input.value = '3'
			global.ui.radius_input = radius_input
		}
	}

	{
		// panel size 
		let row = table.appendChild(document.createElement('tr'))
		{
			let col = row.appendChild(document.createElement('td'));
			let label = col.appendChild(document.createElement('label'));
			label.innerText='Panel Size(px):'
		}
		{
			let col = row.appendChild(document.createElement('td'));
			let panel_size_input = col.appendChild(document.createElement('input'));
			panel_size_input.type = 'text'
			panel_size_input.value = '250'
			global.ui.panel_size_input = panel_size_input
		}
	}

	{
		// recovery steps 
		let row = table.appendChild(document.createElement('tr'))
		{
			let col = row.appendChild(document.createElement('td'));
			let reset_input = col.appendChild(document.createElement('input'));
			reset_input.type = 'button'
			reset_input.value = 'Reset'
			reset_input.addEventListener('click', function() {
				reset_simulation()
				update()
			});
		}
		{
			let col = row.appendChild(document.createElement('td'));
			let play_input = col.appendChild(document.createElement('input'));
			play_input.type = 'button'
			play_input.value = 'Play'
			play_input.addEventListener('click', function() {
				if (!global.simulation) {
					reset_simulation()
					global.running = true
					update()
				} else {
					global.running = !global.running
					update()
				}
			});
		}
	}


	let info_div = controls_div.appendChild(document.createElement('div'))
	// info_div.style.fontClass="12 Monaco"
	info_div.style = "padding: 5px"
	info_div.innerHTML=`<p>
	Legend:<br><br>
	it: iteration<br><br>
	pi: pairwise interactions<br><br>
	cp: contagion prob. on interaction<br><br>
	rs: recovery steps<br><br>
	h: healthy count<br><br>
	r: recovered count<br><br>
	s: sick count<br><br>
	Ms: max sick count ever<br><br>
	- One person sick to start with.<br>
	- Same population dynamics in all panels<br>
	- One 'coin-flip' per interaction thresholded 
	  by the different contagion prob. for the
	  transmission
	</p>`




	// var row = table.appendChild(document.createElement('tr'))
	// var column= row.appendChild(document.createElement('td'));
	// column.colSpan = 2
	// var polygon_input= column.appendChild(document.createElement('input'));
	// polygon_input.type = "button"
	// polygon_input.value = 'Create Polygon'
	// polygon_input.addEventListener('click', function() {
	// 	global.state = STATE_POLYGON_CREATION
	// 	global.polygon_being_created = { points:[] }
	// });
	// var export_input= column.appendChild(document.createElement('input'));
	// export_input.type = "button"
	// export_input.value = 'Export'
	// export_input.addEventListener('click', function() {
	// 	global.export_tile_numbers = true
	// 	global.events.push({ 'type':EVENT_REDRAW, version:0 })
	// });


	// main_div
	let main_div = document.createElement('div')
	global.ui.main_div = main_div
	main_div.id = 'main_div'
	main_div.style = 'position:absolute; width:calc(100% - 200px); left: 200px; height:100%; background-color: #000000;'

	let main_canvas = main_div.appendChild(document.createElement('canvas'))
	global.ui.main_canvas = main_canvas
	main_canvas.style='position: relative; left:0px; top:0px; z-index:1;'
	main_canvas.id = 'main_canvas'
	main_canvas.tabindex = '1'

	var body = document.getElementsByTagName('body')[0]
	global.ui.body = body
	body.style.margin='0px'
	body.appendChild(controls_div)
	body.appendChild(main_div)

	// function simulation_init(n, width, height, radius, contagion_probs, recovery_steps)
	// global.simulation = simulation_init(100, 3, 250, 250, [1, 0.5, 0.25], [125,250])

	setTimeout(update, 16)
}
